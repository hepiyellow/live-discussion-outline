import type { OutlineNode } from '@/types'

/** Every node of the tree, depth first, parents before their children. */
export function allNodes(nodes: OutlineNode[]): OutlineNode[] {
    return nodes.flatMap(n => [n, ...allNodes(n.children)])
}

/**
 * Numbers that more than one node carries, in the order they first repeat. The page knows a node by its number (its
 * approval, what was read of it, the messages about it), so nodes that share one cannot be told apart.
 */
export function duplicateNums(nodes: OutlineNode[]): string[] {
    const seen = new Set<string>()
    const twice = new Set<string>()
    for (const { num } of allNodes(nodes)) {
        if (num && seen.has(num)) twice.add(num)
        seen.add(num)
    }
    return [...twice]
}

/** The number of a node's parent: `2.1` for `2.1.3`, `` for a topic. */
export const parentNum = (num: string) => num.split('.').slice(0, -1).join('.')

/** `2.1.3` → `2`, `2.1`, `2.1.3`. */
export const pathNums = (num: string) => num.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))

/** The node tagged @current and every ancestor on its path: they get the current-path line. */
export function currentPath(nodes: OutlineNode[]): Set<string> {
    const current = allNodes(nodes).find(n => n.tags.includes('current'))
    return new Set(current ? pathNums(current.num) : [])
}

/** Whether a node has nodes under it, and so can collapse. */
export const isParent = (node: OutlineNode) => node.children.length > 0

/** A topic or parent node starts open unless the user approved it; the viewer's own choices override that. */
export const startsOpen = (node: OutlineNode) => node.status !== 'approved'

/** The reference label of a node: its number and title, as references and the queue name it. */
export const nodeLabel = (node: OutlineNode) => `${node.num} ${node.title}`.trim()
