import type { ClosingLine, OutlineNode } from '@/types'

/** The sparkle of the agent's claim: a recommendation is one. */
const SPARKLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/></svg>'
/** The play triangle of an action still to run, outlined; the one of an action done is filled (`DONE_ICON`). */
const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l8-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
const CLOSING_PILL: Record<ClosingLine['kind'], string> = {
    summary: '<span class="pill pill-summary" title="A summary of this node\'s text">Summary</span>',
    recommendation: `<span class="pill pill-recommendation" title="A recommendation for this node">${SPARKLE_ICON} Recommendation</span>`,
    action: `<span class="pill pill-action" title="What running this action will do">${PLAY_ICON} Action</span>`,
}

/** The filled play triangle of an action done: not a tick, which is the user's approval alone. */
const DONE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l8-5z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
const FAILED_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
/** The tag of an action the agent tried and could not carry out. It can be run again. */
export const FAILED_PILL = `<span class="pill pill-failed" title="The agent tried this action, and it failed">${FAILED_ICON} Failed</span>`
/** The tag of an action the agent has carried out: its Action tag turns into this one. */
export const DONE_PILL = `<span class="pill pill-done" title="The agent carried out this action">${DONE_ICON} Done</span>`

/** A node's closing lines, each after its tag. Once the agent has run an action, its Action tag reads Done (or Failed). */
const closingHtml = (node: OutlineNode) => {
    const outcome = node.tags.includes('ran') ? DONE_PILL : node.tags.includes('failed') ? FAILED_PILL : null
    return node.closing.map(c => `<div class="closing">${(c.kind === 'action' && outcome) || CLOSING_PILL[c.kind]} ${c.html}</div>`).join('')
}

/**
 * A node's tagged lines (summary, recommendation, action) and then its text, as one piece of HTML: the tags come first,
 * before the free prose. That an action now reads Done (or Failed) is a change of what the node shows, so the viewer
 * gets it as an unread change to open.
 */
export const contentHtml = (node: OutlineNode) => closingHtml(node) + node.html

/** What `contentHtml` was before the tags came first (text, then tags), which versions the viewer read before then are in. */
const legacyContentHtml = (node: OutlineNode) => node.html + closingHtml(node)

/** The Action tag as the button that runs the action. Its icon gives way to a turning ring while the agent has not finished. */
const runButton = (label: string) =>
    `<button type="button" class="pill pill-action run" data-run title="Run this action: ask the agent to do it now"><span class="run-icon">${PLAY_ICON}</span> ${label}</button>`

/**
 * `contentHtml` as the Outline tab shows it: on an action still to run, the Action tag is the button that runs it. A
 * failed action keeps its Failed tag, and the button beside it reads "Run again". An action without an Action line gets
 * the button on a line of its own, before the text like every tag. What the viewer has read (`readVersion`) and the node
 * history keep the plain tags.
 */
export const liveHtml = (node: OutlineNode) => {
    if (!node.tags.includes('action') || node.tags.includes('ran')) return contentHtml(node)
    const button = runButton(node.tags.includes('failed') ? 'Run again' : 'Action')
    const failed = node.tags.includes('failed') ? FAILED_PILL : ''
    const lines = node.closing.map(c => `<div class="closing">${c.kind === 'action' ? failed + button : CLOSING_PILL[c.kind]} ${c.html}</div>`)
    // Without an Action line a failed action's tag is on its title.
    if (!node.closing.some(c => c.kind === 'action')) lines.push(`<div class="closing">${button}</div>`)
    return lines.join('') + node.html
}

/** What a node shows: its title and its text, as HTML. */
export interface NodeContent {
    titleHtml: string
    html: string
}

const SEP = '\u0001'

/** A node as the viewer reads it, as one string: what the viewer state keeps of each node they have read. */
export const readVersion = (node: OutlineNode) => `${node.titleHtml}${SEP}${contentHtml(node)}`

/**
 * `readVersion` as it was before the tags came first. A node read in that form and unchanged since is not an unread
 * change; the page takes it as read in the new form. (Drop this once every viewer state has been through one load.)
 */
export const legacyReadVersion = (node: OutlineNode) => `${node.titleHtml}${SEP}${legacyContentHtml(node)}`

export function parseVersion(version: string): NodeContent {
    const [titleHtml, html = ''] = version.split(SEP)
    return { titleHtml, html }
}
