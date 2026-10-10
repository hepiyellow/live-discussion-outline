import { useLayoutEffect, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Statuses } from '@/lib/status'
import type { QueueItem } from '@/types'
import { DIFF_ICON, KINDS, waiting } from './queue'

/** A button's height and the gap between buttons, as drawn below: the column fits as many as its height allows. */
const ITEM = 22
const GAP = 4

/** One button of the column: a node changed since the viewer read it, or an item of the agent's queue. */
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

interface Props {
    queue: QueueItem[]
    statuses: Statuses
    runs: Record<string, number>
    onOpen: (item: QueueItem, color: string) => void
    /** Nodes changed since the viewer read them, in outline order: listed first. */
    unread: string[]
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

/**
 * The queue: a column in the margin left of the Outline tab, fixed while the outline scrolls, so that a queue item
 * scrolls its node up beside it, next to the node's diff button. The most important item is at the top. Items that
 * arrive while the page is open slide in from the right edge of the window. Items that do not fit the window's height
 * are counted on an ellipsis at the end, which lists them; the count pulses when a new item lands there.
 */
export function QueueColumn({ queue, statuses, runs, onOpen, unread, onOpenUnread, ready, footer }: Props) {
    const entries: Entry[] = [
        ...unread.map(num => ({
            key: `unread:${num}`,
            num,
            label: 'Changed since you read it',
            title: `Changed since you read it: ${num} (shows the node; click its diff button to see the change)`,
            color: 'var(--claim)',
            icon: DIFF_ICON,
            open: () => onOpenUnread(num),
            data: { 'data-unread': num },
        })),
        ...waiting(queue, statuses, runs).map(({ item, missing }) => {
            const kind = KINDS[item.kind]
            return {
                key: `${item.kind}:${item.num}`,
                num: item.num,
                label: item.label,
                title: `${kind.name} ${item.num}: ${item.label}${missing ? ' (not in the outline)' : ''}`,
                color: kind.color,
                icon: kind.icon,
                open: () => onOpen(item, kind.color),
                data: { 'data-queue': item.num, 'data-kind': item.kind },
                missing,
            }
        }),
    ]

    // How many buttons fit: the column's height less the inbox under it.
    const col = useRef<HTMLDivElement>(null)
    const foot = useRef<HTMLDivElement>(null)
    const [room, setRoom] = useState(Infinity)
    useLayoutEffect(() => {
        const el = col.current
        if (!el) return
        const measure = () => setRoom(Math.max(1, Math.floor((el.clientHeight - (foot.current?.offsetHeight ?? 0) + GAP) / (ITEM + GAP))))
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        if (foot.current) ro.observe(foot.current)
        measure()
        return () => ro.disconnect()
    }, [])
    const shown = entries.length <= room ? entries : entries.slice(0, room - 1)
    const hidden = entries.slice(shown.length)
    const [moreOpen, setMoreOpen] = useState(false)

    // What the column showed last; whatever is not in it has just arrived.
    const before = useRef<Set<string> | null>(null)
    const keys = entries.map(e => e.key).join('\n')
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
            <div ref={col} className="queue-col">
                {entries.length > 0 && (
                    <ol aria-label="Your queue" className="flex flex-col gap-1">
                        {shown.map(e => (
                            <li key={e.key} data-key={e.key}>
                                <button type="button" {...e.data} title={e.title} onClick={e.open} className={cn(BUTTON, e.missing && 'opacity-50')}>
                                    <span style={{ color: e.color }} className="inline-flex">
                                        {e.icon}
                                    </span>
                                    <span className="truncate">{e.num}</span>
                                </button>
                            </li>
                        ))}
                        {hidden.length > 0 && (
                            <li>
                                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                                    <PopoverTrigger asChild>
                                        <button type="button" data-queue-more={hidden.length} title={`${hidden.length} more in your queue`} className={cn(BUTTON, 'justify-center text-muted-foreground')}>
                                            <Ellipsis aria-hidden="true" />
                                            <span>{hidden.length}</span>
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent side="right" align="end" className="w-80 p-1">
                                        <ol aria-label="More of your queue" className="flex flex-col">
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
                                                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0', e.missing && 'opacity-50')}
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
