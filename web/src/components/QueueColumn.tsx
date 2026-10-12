import { useLayoutEffect, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { KEY_TITLE, markOfKey, type KindKey, type Mark, type Statuses } from '@/lib/status'
import type { QueueItem } from '@/types'
import { DIFF_ICON, KINDS, PLUS_ICON, waiting } from './queue'
import { keyIcon } from './StatusBox'

/** A button's height and the gap between buttons, as drawn below: the lower queue fits as many as its room allows. */
const ITEM = 22
const GAP = 4
/** The divider between the two queues, with the room around it. */
const DIVIDER = 13

/** One button of the column: an item of the action queue, or the indicator of a change the viewer has not opened. */
interface Entry {
    key: string
    num: string
    label: string
    title: string
    color: string
    icon: React.ReactNode
    open: () => void
    /** Attributes the tests and the page look the button up by. */
    data: Record<string, string>
    missing?: boolean
}

/** A change the viewer has not opened, as the column shows it. */
export interface ChangeIndicator {
    num: string
    kind: 'changed' | 'added'
    /** The change carries out a task: the node now has the agent's Done tag. */
    done?: boolean
    /** The node's own kind mark after the change, when it differs from the one it shows now. */
    mark?: KindKey
}

/** The colors of the kind marks, as the rows draw them. */
const MARK_COLOR: Record<Mark, string> = { claim: 'var(--claim)', question: 'var(--danger)', answered: 'var(--danger)', failed: 'var(--danger)', action: 'var(--done)', done: 'var(--done)' }

interface Props {
    queue: QueueItem[]
    statuses: Statuses
    runs: Record<string, number | string>
    /** The viewer state's `seen`: the read items the user marked as read are in it. */
    seen: Record<string, number>
    onOpen: (item: QueueItem, color: string) => void
    /** The changes the viewer has not opened, in outline order. */
    changes: ChangeIndicator[]
    onOpenUnread: (num: string) => void
    /** False until the viewer state has loaded: what the column shows then is not new. */
    ready: boolean
    /** At the bottom of the column: the inbox. */
    footer?: React.ReactNode
}

const BUTTON = 'flex h-[22px] w-16 items-center gap-1 rounded-md border bg-background px-[5px] text-[11px] leading-tight tabular-nums hover:bg-accent [&_svg]:size-3 [&_svg]:shrink-0'

/** Slides a button in from the right edge of the window to its place. */
function slideIn(el: HTMLElement, delay: number) {
    const dx = innerWidth - el.getBoundingClientRect().left
    el.animate([{ transform: `translateX(${dx}px)`, opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 650, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' })
}

function EntryButton({ entry: e }: { entry: Entry }) {
    return (
        <button type="button" {...e.data} title={e.title} onClick={e.open} className={cn(BUTTON, e.missing && 'opacity-50')}>
            <span style={{ color: e.color }} className="inline-flex">
                {e.icon}
            </span>
            <span className="truncate">{e.num}</span>
        </button>
    )
}

/**
 * The column in the margin left of the Outline tab, fixed while the outline scrolls, so that an item scrolls its node
 * up beside it. It holds two queues, one below the other, with a divider between them.
 *
 * On top, the action queue: the actions that wait for the user, most important first, each drawn with the kind mark of
 * its node. It is always shown in full; past the window's height the column scrolls.
 *
 * Below, the change indicators: one for each change the viewer has not opened, in outline order. It is drawn with what
 * opening the change brings: the node's new kind mark when that changes, a plus over a minus when only its wording
 * does, a plus for a node that was added. A node that has an action item shows once, among the actions: the item
 * leads to the same row, where the diff button is. The indicators get the room that is left; those that do not fit
 * are counted on an ellipsis at the end, which lists them, and the count pulses when a new one lands there.
 *
 * Items that arrive while the page is open slide in from the right edge of the window.
 */
export function QueueColumn({ queue, statuses, runs, seen, onOpen, changes: waitingChanges, onOpenUnread, ready, footer }: Props) {
    const changed = new Set(waitingChanges.map(c => c.num))
    const actions: Entry[] = waiting(queue, statuses, runs, seen).map(({ item, missing }) => {
        const kind = KINDS[item.kind]
        return {
            key: `${item.kind}:${item.num}`,
            num: item.num,
            label: item.label,
            title: `${kind.name} ${item.num}: ${item.label}${missing ? ' (not in the outline)' : changed.has(item.num) ? ' (it changed since you read it: open the change on its row first)' : ''}`,
            color: kind.color,
            icon: kind.icon,
            open: () => onOpen(item, kind.color),
            data: { 'data-queue': item.num, 'data-kind': item.kind },
            missing,
        }
    })
    const asked = new Set(actions.map(a => a.num))
    const changes: Entry[] = waitingChanges
        .filter(c => !asked.has(c.num))
        .map(({ num, kind, done, mark }) => {
            const added = kind === 'added'
            const label = added ? 'Added since you last looked' : mark ? `Changed since you read it, to: ${KEY_TITLE[mark]}` : `Changed since you read it${done ? ', and now done' : ''}`
            return {
                key: `unread:${num}`,
                num,
                label,
                title: `${label}: ${num} (shows the node; click its diff button to ${added ? 'open it' : 'see the change'})`,
                // A change whose new content has the Done tag is an action carried out: yellow, as the node's own diff button is.
                color: mark ? MARK_COLOR[markOfKey(mark)] : done ? 'var(--done)' : 'var(--claim)',
                icon: added ? PLUS_ICON : mark ? keyIcon(mark) : DIFF_ICON,
                open: () => onOpenUnread(num),
                data: { 'data-unread': num, 'data-change': kind, ...(mark ? { 'data-mark': mark } : {}), ...(done ? { 'data-done': '' } : {}) },
            }
        })

    // How many change indicators fit: the column's height less the action queue above and the inbox under it.
    const col = useRef<HTMLDivElement>(null)
    const top = useRef<HTMLOListElement>(null)
    const foot = useRef<HTMLDivElement>(null)
    const [room, setRoom] = useState(Infinity)
    const [tall, setTall] = useState(false)
    const hasActions = actions.length > 0
    useLayoutEffect(() => {
        const el = col.current
        if (!el) return
        const measure = () => {
            const above = top.current ? top.current.offsetHeight + DIVIDER : 0
            const free = el.clientHeight - (foot.current?.offsetHeight ?? 0) - above
            setRoom(Math.max(1, Math.floor((free + GAP) / (ITEM + GAP))))
            // The action queue is never cut: when it alone is higher than the column, the column scrolls.
            setTall(above > el.clientHeight - (foot.current?.offsetHeight ?? 0))
        }
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        if (top.current) ro.observe(top.current)
        if (foot.current) ro.observe(foot.current)
        measure()
        return () => ro.disconnect()
    }, [hasActions])
    const shown = changes.length <= room ? changes : changes.slice(0, room - 1)
    const hidden = changes.slice(shown.length)
    const [moreOpen, setMoreOpen] = useState(false)

    // What the column showed last; whatever is not in it has just arrived.
    const before = useRef<Set<string> | null>(null)
    const keys = [...actions, ...changes].map(e => e.key).join('\n')
    useLayoutEffect(() => {
        if (!ready) return
        const last = before.current
        before.current = new Set(keys.split('\n'))
        if (!last || document.visibilityState !== 'visible' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const added = keys.split('\n').filter(k => k && !last.has(k))
        added.forEach((k, i) => {
            const el = col.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`)
            if (el) slideIn(el, i * 90)
        })
        const more = col.current?.querySelector<HTMLElement>('[data-queue-more]')
        if (more && added.some(k => !col.current?.querySelector(`[data-key="${CSS.escape(k)}"]`))) {
            more.removeAttribute('data-pulse')
            void more.offsetWidth
            more.setAttribute('data-pulse', '')
        }
    }, [keys, ready])

    return (
        <div className="queue-anchor">
            <div ref={col} className={cn('queue-col', tall && 'overflow-y-auto')}>
                {hasActions && (
                    <ol ref={top} aria-label="Your queue" className="flex shrink-0 flex-col gap-1">
                        {actions.map(e => (
                            <li key={e.key} data-key={e.key}>
                                <EntryButton entry={e} />
                            </li>
                        ))}
                    </ol>
                )}
                {hasActions && changes.length > 0 && <hr data-queue-divider className="my-1.5 w-16 shrink-0 border-t" />}
                {changes.length > 0 && (
                    <ol aria-label="Changes to open" className="flex shrink-0 flex-col gap-1">
                        {shown.map(e => (
                            <li key={e.key} data-key={e.key}>
                                <EntryButton entry={e} />
                            </li>
                        ))}
                        {hidden.length > 0 && (
                            <li>
                                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                                    <PopoverTrigger asChild>
                                        <button type="button" data-queue-more={hidden.length} title={`${hidden.length} more changes to open`} className={cn(BUTTON, 'justify-center text-muted-foreground')}>
                                            <Ellipsis aria-hidden="true" />
                                            <span>{hidden.length}</span>
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent side="right" align="end" className="w-80 p-1">
                                        <ol aria-label="More changes to open" className="flex flex-col">
                                            {hidden.map(e => (
                                                <li key={e.key} data-key={e.key}>
                                                    <button
                                                        type="button"
                                                        {...e.data}
                                                        title={e.title}
                                                        onClick={() => {
                                                            setMoreOpen(false)
                                                            e.open()
                                                        }}
                                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0"
                                                    >
                                                        <span style={{ color: e.color }} className="inline-flex">
                                                            {e.icon}
                                                        </span>
                                                        <span className="tabular-nums">{e.num}</span>
                                                        <span className="truncate text-muted-foreground">{e.label}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ol>
                                    </PopoverContent>
                                </Popover>
                            </li>
                        )}
                    </ol>
                )}
                <div ref={foot} className="mt-auto flex flex-col pt-1">
                    {footer}
                </div>
            </div>
        </div>
    )
}
