import type { OutlineNode } from '@/types'

/** What the page shows for the title of an outline nobody has named yet. */
export const UNTITLED = 'Untitled'

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

/**
 * What `runs` keeps for an action the viewer asked to run: 1, or for an action that failed before (its Failed tag
 * stays until the agent finishes it again) a mark of what the node showed then, so that a new outcome ends the run.
 */
export const runMark = (node: OutlineNode): number | string => {
    if (!node.tags.includes('failed')) return 1
    let h = 0
    for (const ch of node.html + node.closing.map(c => c.html).join('\n')) h = (h * 31 + ch.charCodeAt(0)) | 0
    return `failed:${h}`
}

/** Whether an action the viewer asked to run is still waiting for the agent: not done, and not failed anew. */
export const stillRunning = (node: OutlineNode, mark: unknown) =>
    node.tags.includes('action') && !node.tags.includes('ran') && (!node.tags.includes('failed') || mark === runMark(node))

/** The reference label of a node: its number and title, as references and the queue name it. */
export const nodeLabel = (node: OutlineNode) => `${node.num} ${node.title}`.trim()
