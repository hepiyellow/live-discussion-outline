import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UNTITLED, allNodes, currentPath } from '@/lib/outline'
import { KIND_COLUMNS, SHOW_TITLE_CHECKBOX, Statuses, kindColumnsInView, marksChanged, type KindKey, type MarksChange } from '@/lib/status'
import { markStuck } from '@/lib/sticky'
import { cn } from '@/lib/utils'
import type { Outline, OutlineNode, ViewerState } from '@/types'
import { NodeHistory } from './NodeHistory'
import { OutlineCtx, Topic, type OutlineContext } from './NodeView'
import { waiting } from './queue'
import { RenameTitle } from './RenameTitle'

/** Which topics and parents the viewer opened or closed; the rest follow the statuses' `startsOpen`. */
export type OpenNodes = Record<string, boolean>

/** How long a parent the viewer had opened stays open after it becomes settled, in milliseconds. */
const SETTLE_PAUSE = 700

/** How long the kind marks that changed as a change was opened are drawn pulsing, a little over one grow and shrink. */
const PULSE_MS = 700

export const isOpenIn = (open: OpenNodes, statuses: Statuses) => (node: OutlineNode) => (node.num in open ? open[node.num] : statuses.startsOpen(node))

/**
 * The Outline tab: any text before the first topic, then the topics with their nodes. An outline nobody has named yet
 * starts with the field that names it; once it has a title, the top bar shows it.
 */
/** The user's actions on nodes, from useApprovals. */
export type NodeActions = Pick<
    OutlineContext,
    'linked' | 'onCheck' | 'onTopicCheck' | 'onRun' | 'onReference' | 'onRemove' | 'pending' | 'unread' | 'opening' | 'onOpenChange' | 'unreadUnder' | 'onOpenUnreadUnder' | 'messagesFor' | 'seen' | 'onSeen' | 'onReveal'
>

interface Props {
    outline: Outline
    /** The outline's nodes as the viewer sees them while changes wait to be opened (`shownNodes`). */
    shown: OutlineNode[]
    viewer: ViewerState
    actions: NodeActions
    onToggle: (node: OutlineNode, open: boolean) => void
}

/**
 * What an outline without nodes says. One the server opened for a session it has just started links to no session
 * until that session's agent attaches to it.
 */
const EMPTY = {
    starting: 'This outline is empty, and its agent is starting. Write below to begin. If nothing answers, look at the Terminal view: the agent may be asking something there.',
    linked: 'This outline is empty. Write to the agent below to begin.',
    unlinked: 'This outline is empty.',
}

export function OutlineTab({ outline, shown, viewer, actions, onToggle }: Props) {
    const root = useRef<HTMLDivElement>(null)
    const [historyOf, setHistoryOf] = useState<OutlineNode | null>(null)
    // The changes that wait. One being opened no longer does: its marks turn as the animation starts.
    const unopened = useMemo(() => new Set(actions.pending.keys()), [actions.pending])
    // The kind marks that changed as a change was opened.
    const [pulse, setPulse] = useState<Map<string, MarksChange>>(new Map())
    const ctx = useMemo<OutlineContext>(() => {
        // The marks are those of the outline as it is shown: a node whose change waits keeps the kind it was read with.
        const statuses = new Statuses(shown, viewer.overrides, outline.mode, new Set(outline.unacked), unopened)
        const isOpen = isOpenIn(viewer.open, statuses)
        return {
            ...actions,
            onHistory: setHistoryOf,
            statuses,
            // The first item about a node, as the queue column lists them.
            queued: new Map(
                waiting(outline.queue, statuses, viewer.runs, viewer.seen)
                    .filter(q => !q.missing)
                    .reverse()
                    .map(q => [q.item.num, q.item]),
            ),
            isOpen,
            kindColumns: withGone(kindColumnsInView(shown, statuses, isOpen), pulse),
            pulse,
            toggle: node => onToggle(node, !isOpen(node)),
            current: currentPath(shown),
            runs: viewer.runs,
        }
    }, [outline, shown, viewer.open, viewer.overrides, viewer.runs, viewer.seen, actions, unopened, pulse, onToggle])

    // Opening a change turns the marks it held back: each one that differs from before grows and shrinks once. What it
    // was is the outline as it was shown with the change still unopened, so only the click makes a difference.
    const prevUnopened = useRef<Set<string> | null>(null)
    const prevStatuses = useRef<Statuses | null>(null)
    const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(pulseTimer.current), [])
    useLayoutEffect(() => {
        const before = prevUnopened.current
        const was = prevStatuses.current
        prevUnopened.current = unopened
        if (!before || !was) return
        const opened = [...before].filter(num => !unopened.has(num))
        if (!opened.length) return
        const changes = marksChanged(was, ctx.statuses)
        if (!changes.size) return
        clearTimeout(pulseTimer.current)
        setPulse(changes)
        pulseTimer.current = setTimeout(() => setPulse(new Map()), PULSE_MS)
        // Only a change of what is unopened matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unopened])
    // After the comparison above: what the outline showed on the render before a change is opened.
    useLayoutEffect(() => {
        prevStatuses.current = ctx.statuses
    })

    // A parent that becomes settled collapses, also one the viewer had opened themselves: such a parent would stay
    // open by their choice, so it is closed here. After a pause, since a click that settles a parent closes it itself,
    // with its own animation.
    const settled = useRef<Set<string> | null>(null)
    const latest = useRef({ shown, open: viewer.open, statuses: ctx.statuses, onToggle })
    latest.current = { shown, open: viewer.open, statuses: ctx.statuses, onToggle }
    useEffect(() => {
        const now = new Set(allNodes(shown).filter(n => ctx.statuses.isSettled(n)).map(n => n.num))
        const before = settled.current
        settled.current = now
        // On the first pass nothing became settled: it is how the outline was found.
        if (!before) return
        const turned = [...now].filter(num => !before.has(num) && viewer.open[num])
        if (!turned.length) return
        const timer = setTimeout(() => {
            const { shown, open, statuses, onToggle } = latest.current
            for (const n of allNodes(shown)) if (turned.includes(n.num) && open[n.num] && statuses.isSettled(n)) onToggle(n, false)
        }, SETTLE_PAUSE)
        return () => clearTimeout(timer)
        // Only a change of what is settled matters: the viewer opening a node is not one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shown, ctx.statuses])

    // The header stack follows scrolling, resizing, and every change of the content.
    useLayoutEffect(() => {
        const el = root.current
        if (!el) return
        let queued = false
        const queue = () => {
            if (queued) return
            queued = true
            requestAnimationFrame(() => {
                queued = false
                markStuck(el)
            })
        }
        addEventListener('scroll', queue, { passive: true })
        addEventListener('resize', queue)
        const ro = new ResizeObserver(queue)
        ro.observe(el)
        return () => {
            removeEventListener('scroll', queue)
            removeEventListener('resize', queue)
            ro.disconnect()
        }
    }, [])
    useLayoutEffect(() => {
        if (root.current) markStuck(root.current)
    })

    return (
        <OutlineCtx.Provider value={ctx}>
            {historyOf && <NodeHistory project={outline.project} file={outline.file} node={historyOf} bottom={actions.linked ? 'var(--composer-h, 60px)' : '0px'} onClose={() => setHistoryOf(null)} />}
            <div ref={root} className="outline-tab" data-ck={SHOW_TITLE_CHECKBOX ? undefined : 'hidden'}>
                {outline.untitled && (
                    <h1 data-untitled className="mt-10 text-center text-xl font-semibold">
                        <RenameTitle project={outline.project} file={outline.file} title="" className="mx-auto max-w-md">
                            <span className="text-muted-foreground">{UNTITLED}</span>
                        </RenameTitle>
                    </h1>
                )}
                {outline.intro && <div className="outline-intro" dangerouslySetInnerHTML={{ __html: outline.intro }} />}
                {!outline.intro && !outline.nodes.length && (
                    <p data-empty role="status" className={cn(outline.untitled ? 'mt-3' : 'mt-10', 'text-center text-sm text-muted-foreground')}>
                        {EMPTY[!actions.linked ? 'unlinked' : outline.mode === 'server' && !outline.session ? 'starting' : 'linked']}
                    </p>
                )}
                {shown.map(n => (
                    <Topic key={n.num} node={n} />
                ))}
            </div>
        </OutlineCtx.Provider>
    )
}

/** The columns, and those of the marks that went and are still drawn while they pulse, in column order. */
function withGone(columns: KindKey[], pulse: Map<string, MarksChange>): KindKey[] {
    const gone = new Set<KindKey>()
    for (const c of pulse.values()) for (const key of Object.keys(c.gone) as KindKey[]) gone.add(key)
    return gone.size ? KIND_COLUMNS.filter(k => columns.includes(k) || gone.has(k)) : columns
}
