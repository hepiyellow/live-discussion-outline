import type { ClosingLine, OutlineNode, Tag } from '@/types'

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

/** The tags that say what a node is on the agent's side. The user's approval, and which node is current, are not among them. */
export const AGENT_TAGS: Tag[] = ['claim', 'options', 'recommended', 'action', 'ran', 'failed']

/** A node's kind as the agent gave it: its agent-side tags, and which closing lines it has (a recommendation makes a claim). */
export interface KindRead {
    tags: Tag[]
    closing: ClosingLine['kind'][]
}

/** What a node shows: its title and its text, as HTML, and its kind when that was kept. */
export interface NodeContent {
    titleHtml: string
    html: string
    kind?: KindRead
}

const SEP = '\u0001'

const wordingOf = (node: OutlineNode) => `${node.titleHtml}${SEP}${contentHtml(node)}`
/** A parent's claim is not its own: it follows the nodes under it, and changes with them, so it is not part of its kind. */
const kindOf = (node: OutlineNode): KindRead => ({ tags: AGENT_TAGS.filter(t => node.tags.includes(t) && !(t === 'claim' && node.children.length)), closing: node.closing.map(c => c.kind) })

/**
 * A node as the viewer reads it, as one string: what the viewer state keeps of each node they have read. Its title,
 * its text and its kind: a change of any of them is a change to open.
 */
export const readVersion = (node: OutlineNode) => `${wordingOf(node)}${SEP}${JSON.stringify(kindOf(node))}`

/** The title and text of a version, without its kind: two nodes that read alike have the same. */
export const wording = (version: string) => version.split(SEP).slice(0, 2).join(SEP)

/** `readVersion` as it was before the tags came first. (Drop this once every viewer state has been through one load.) */
const legacyReadVersion = (node: OutlineNode) => `${node.titleHtml}${SEP}${legacyContentHtml(node)}`

/**
 * Whether what the viewer read of a node (`version`) is the node as it is now. A version kept before the kind was
 * part of it, or before the tags came first, counts when its wording is the node's: the page then takes it as read in
 * the form kept now. So does a node the user approved since: the approval is theirs, and an agent that records it in
 * the file may drop its own claim tag for it, which is not a change of kind.
 */
export function isRead(version: string, node: OutlineNode) {
    if (version === readVersion(node)) return true
    if (wording(version) !== wordingOf(node)) return version === legacyReadVersion(node)
    const was = parseVersion(version).kind
    if (!was) return true
    const now = kindOf(node)
    const tags = (kind: KindRead) => kind.tags.filter(t => t !== 'claim' || !(node.tags.includes('approved') || node.children.length)).join()
    return tags(was) === tags(now) && was.closing.join() === now.closing.join()
}

export function parseVersion(version: string): NodeContent {
    const [titleHtml, html = '', kind] = version.split(SEP)
    let read: KindRead | undefined
    try {
        if (kind) read = JSON.parse(kind)
    } catch {}
    return { titleHtml, html, ...(read ? { kind: read } : {}) }
}
