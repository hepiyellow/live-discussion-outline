import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { currentPath, startsOpen } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import { markStuck } from '@/lib/sticky'
import type { Outline, OutlineNode, ViewerState } from '@/types'
import { NodeHistory } from './NodeHistory'
import { OutlineCtx, Topic, type OutlineContext } from './NodeView'
import { waiting } from './queue'

/** Which topics and parents the viewer opened or closed; the rest follow `startsOpen`. */
export type OpenNodes = Record<string, boolean>

export const isOpenIn = (open: OpenNodes) => (node: OutlineNode) => (node.num in open ? open[node.num] : startsOpen(node))

/** The Outline tab: the title, any text before the first topic, then the topics with their nodes. */
/** The user's actions on nodes, from useApprovals. */
export type NodeActions = Pick<OutlineContext, 'linked' | 'onCheck' | 'onTopicCheck' | 'onRun' | 'onReference' | 'onRemove' | 'unread' | 'opening' | 'onOpenUnread' | 'unreadUnder' | 'onOpenUnreadUnder' | 'messagesFor' | 'seen' | 'onSeen' | 'onReveal'>

interface Props {
    outline: Outline
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

export function OutlineTab({ outline, viewer, actions, onToggle }: Props) {
    const root = useRef<HTMLDivElement>(null)
    const [historyOf, setHistoryOf] = useState<OutlineNode | null>(null)
    const ctx = useMemo<OutlineContext>(() => {
        const isOpen = isOpenIn(viewer.open)
        // A change being opened counts as read: its box turns done as the animation starts.
        const unopened = new Set([...actions.unread.keys()].filter(num => !actions.opening.has(num)))
        const statuses = new Statuses(outline.nodes, viewer.overrides, outline.mode, new Set(outline.unacked), unopened)
        return {
            ...actions,
            onHistory: setHistoryOf,
            statuses,
            // The first item about a node, as the queue column lists them.
            queued: new Map(
                waiting(outline.queue, statuses, viewer.runs)
                    .filter(q => !q.missing)
                    .reverse()
                    .map(q => [q.item.num, q.item]),
            ),
            isOpen,
            toggle: node => onToggle(node, !isOpen(node)),
            current: currentPath(outline.nodes),
            runs: viewer.runs,
        }
    }, [outline, viewer.open, viewer.overrides, viewer.runs, actions, onToggle])

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
            {historyOf && <NodeHistory project={outline.project} file={outline.file} node={historyOf} onClose={() => setHistoryOf(null)} />}
            <div ref={root} className="outline-tab">
                {outline.intro && <div className="outline-intro" dangerouslySetInnerHTML={{ __html: outline.intro }} />}
                {!outline.intro && !outline.nodes.length && (
                    <p data-empty role="status" className="mt-10 text-center text-sm text-muted-foreground">
                        {EMPTY[!actions.linked ? 'unlinked' : outline.mode === 'server' && !outline.session ? 'starting' : 'linked']}
                    </p>
                )}
                {outline.nodes.map(n => (
                    <Topic key={n.num} node={n} />
                ))}
            </div>
        </OutlineCtx.Provider>
    )
}
