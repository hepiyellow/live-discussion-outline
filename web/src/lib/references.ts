import { nodeLabel } from '@/lib/outline'
import type { Outline, OutlineNode } from '@/types'

// The lines the page writes about a node for the agent to read, the same in file mode and in server mode.

/** A node's path and name: `3. Topic › 3.1.2 Node`. */
function pathTo(outline: Outline, node: OutlineNode) {
    const topicNum = node.num.split('.')[0]
    const topic = outline.nodes.find(n => n.num === topicNum)
    const topicLabel = (t: OutlineNode) => `${t.num}. ${t.title}`
    if (node.level === 1) return topicLabel(node)
    return (topic ? `${topicLabel(topic)} › ` : '') + nodeLabel(node)
}

/** A reference to a node to paste into the chat: `Re: outline "<title>" › 3. Topic › 3.1.2 Node`. */
export const referenceTo = (outline: Outline, node: OutlineNode) => `Re: outline "${outline.title || outline.file}" › ${pathTo(outline, node)}`

/** What the trash button sends about a node, before the user's reason: `Removed from the outline: 3. Topic › 3.1.2 Node`. */
export const removalOf = (outline: Outline, node: OutlineNode) => `Removed from the outline: ${pathTo(outline, node)}`
