import { AGENT_TAGS, type NodeContent } from '@/lib/content'
import type { OutlineNode } from '@/types'

/**
 * A change the agent made to a node that the page holds back until the viewer opens it. `changed`: the node's title,
 * text or kind differs from what they read (`was`). `added`: the node is new to them, and everything under it with it.
 */
export interface PendingChange {
    kind: 'changed' | 'added'
    /** A changed node as the viewer read it. */
    was?: NodeContent
    /** The change carries out a task: the node now has the agent's Done tag. */
    done?: boolean
}

/**
 * The outline as the viewer sees it while changes wait to be opened: the tree does not change by itself.
 *
 * A changed node keeps the kind it had when they read it (its agent-side tags and its closing lines), so its kind
 * marks, and those rolled up on its parents, are the old ones; its title and text are shown from what was read. The
 * user's own approval is not held back: it is theirs, and applies at once.
 *
 * An added node is there as a bare row: its title, and nothing of its text, its kind or the nodes under it.
 */
export function shownNodes(nodes: OutlineNode[], pending: ReadonlyMap<string, PendingChange>): OutlineNode[] {
    if (!pending.size) return nodes
    const shown = nodes.map((node): OutlineNode => {
        const change = pending.get(node.num)
        if (change?.kind === 'added') return { ...node, tags: node.tags.filter(t => t === 'current' || t === 'option'), status: 'open', html: '', closing: [], children: [] }
        const children = shownNodes(node.children, pending)
        const kind = change?.kind === 'changed' ? change.was?.kind : undefined
        if (!kind) return children === node.children ? node : { ...node, children }
        const claim = kind.tags.includes('claim') || kind.tags.includes('recommended') || kind.closing.includes('recommendation')
        return {
            ...node,
            tags: [...node.tags.filter(t => !AGENT_TAGS.includes(t)), ...kind.tags],
            status: node.status === 'approved' ? 'approved' : claim ? 'claim' : 'open',
            // Only which closing lines there were is kept; their text is part of what was read, which the row shows.
            closing: kind.closing.map(k => ({ kind: k, html: '' })),
            children,
        }
    })
    // The same list when nothing under it waits, so that what did not change is not drawn anew.
    return shown.every((node, i) => node === nodes[i]) ? nodes : shown
}
