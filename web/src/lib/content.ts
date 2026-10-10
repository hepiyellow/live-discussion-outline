import type { ClosingLine, OutlineNode } from '@/types'

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>'
const CLOSING_PILL: Record<ClosingLine['kind'], string> = {
    summary: '<span class="pill pill-summary" title="A summary of this node\'s text">Summary</span>',
    recommendation: '<span class="pill pill-recommendation" title="A recommendation for this node">💡 Recommendation</span>',
    action: `<span class="pill pill-action" title="What running this action will do">${PLAY_ICON} Action</span>`,
}

const DONE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const FAILED_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
/** The tag of an action the agent tried and could not carry out. It can be run again. */
export const FAILED_PILL = `<span class="pill pill-failed" title="The agent tried this action, and it failed">${FAILED_ICON} Failed</span>`
/** The tag of an action the agent has carried out: its Action tag turns into this one. */
export const DONE_PILL = `<span class="pill pill-done" title="The agent carried out this action">${DONE_ICON} Done</span>`

/**
 * A node's text and its closing lines, each after its tag, as one piece of HTML. Once the agent has run an action, its
 * Action tag reads Done (or Failed): that is a change of what the node shows, so the viewer gets it as an unread change to open.
 */
export const contentHtml = (node: OutlineNode) => {
    const outcome = node.tags.includes('ran') ? DONE_PILL : node.tags.includes('failed') ? FAILED_PILL : null
    return node.html + node.closing.map(c => `<div class="closing">${(c.kind === 'action' && outcome) || CLOSING_PILL[c.kind]} ${c.html}</div>`).join('')
}

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
