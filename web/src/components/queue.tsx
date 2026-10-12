import { CircleCheck, CircleHelp, Eye } from 'lucide-react'
import { allNodes } from '@/lib/outline'
import type { Statuses } from '@/lib/status'
import type { OutlineNode, QueueItem } from '@/types'

/** The icon of a node changed since the viewer read it, in the queue column and on the node's diff button: a plus over a minus. */
export const DIFF_ICON = (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <path d="M8 2.5v6M5 5.5h6M5 12.5h6" />
    </svg>
)

/** How each kind of queue item is drawn: in the queue column, and beside the node it is about. */
export const KINDS: Record<QueueItem['kind'], { name: string; color: string; icon: React.ReactNode }> = {
    decide: { name: 'Decide', color: 'var(--danger)', icon: <CircleHelp aria-hidden="true" /> },
    approve: { name: 'Approve', color: 'var(--tick)', icon: <CircleCheck aria-hidden="true" /> },
    action: {
        name: 'Run',
        color: 'var(--danger)',
        icon: (
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
            </svg>
        ),
    },
    read: { name: 'Read', color: 'var(--foreground)', icon: <Eye aria-hidden="true" /> },
}

/**
 * What the viewer state keeps (in `seen`) once the user has marked a read item as read: the item of that node as it
 * is now. The node's text is part of it, so an item the agent queues again after rewriting the node shows again.
 */
export function readId(item: QueueItem, node: OutlineNode) {
    let h = 0
    for (const ch of `${item.label}\n${node.titleHtml}\n${node.html}`) h = (h * 31 + ch.charCodeAt(0)) | 0
    return `read:${item.num}:${(h >>> 0).toString(36)}`
}

/**
 * Whether the user has handled a queue item on the page: an action once run, a read item once they marked it read,
 * anything else once it (or every node under it) is approved or picked. The agent drops it from the file later.
 */
function handled(item: QueueItem, statuses: Statuses, runs: Record<string, number | string>, seen: Record<string, number>) {
    const node = allNodes(statuses.nodes).find(n => n.num === item.num)
    if (!node) return { missing: true, done: false }
    if (item.kind === 'read' && seen[readId(item, node)]) return { missing: false, done: true }
    if (item.kind === 'action' && node.level > 1) return { missing: false, done: !node.tags.includes('action') || node.tags.includes('ran') || !!runs[node.num] }
    // A topic's own tick counts only when it has no nodes under it.
    return { missing: false, done: node.level === 1 && node.children.length ? node.children.every(c => statuses.approvedUnder(c)) : statuses.approvedUnder(node) }
}

/**
 * The kind an item is shown as. The agent names it, but a decide item is only for a question the agent has no
 * recommendation for (CONTEXT.md, Queue): when all its node shows is the agent's claim (a question with a recommended
 * option, a claim, a recommendation), there is something proposed to approve, and it is an approve item.
 */
function shownKind(item: QueueItem, statuses: Statuses): QueueItem['kind'] {
    if (item.kind !== 'decide') return item.kind
    const node = allNodes(statuses.nodes).find(n => n.num === item.num)
    if (!node) return item.kind
    const kinds = node.level === 1 && node.children.length ? node.children.flatMap(c => statuses.kindsOf(c)) : statuses.kindsOf(node)
    return kinds.length > 0 && kinds.every(k => k === 'claim') ? 'approve' : 'decide'
}

/** The queue items still waiting for the user, in the agent's order; `missing` when the outline has no such node. */
export const waiting = (queue: QueueItem[], statuses: Statuses, runs: Record<string, number | string>, seen: Record<string, number> = {}) =>
    queue.map(item => ({ item: { ...item, kind: shownKind(item, statuses) }, ...handled(item, statuses, runs, seen) })).filter(q => !q.done)
