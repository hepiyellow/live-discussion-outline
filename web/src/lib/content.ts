import type { ClosingLine, OutlineNode } from '@/types'

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>'
const CLOSING_PILL: Record<ClosingLine['kind'], string> = {
    summary: '<span class="pill pill-summary" title="A summary of this node\'s text">Summary</span>',
    recommendation: '<span class="pill pill-recommendation" title="A recommendation for this node">💡 Recommendation</span>',
    action: `<span class="pill pill-action" title="What running this action will do">${PLAY_ICON} Action</span>`,
}

/** A node's text and its closing lines, each after its tag, as one piece of HTML. */
export const contentHtml = (node: OutlineNode) => node.html + node.closing.map(c => `<div class="closing">${CLOSING_PILL[c.kind]} ${c.html}</div>`).join('')

/** What a node shows: its title and its text, as HTML. */
export interface NodeContent {
    titleHtml: string
    html: string
}

const SEP = '\u0001'

/** A node as the viewer reads it, as one string: what the viewer state keeps of each node they have read. */
export const readVersion = (node: OutlineNode) => `${node.titleHtml}${SEP}${contentHtml(node)}`

export function parseVersion(version: string): NodeContent {
    const [titleHtml, html = ''] = version.split(SEP)
    return { titleHtml, html }
}
