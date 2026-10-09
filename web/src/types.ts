// What the server sends the page. The server stays JavaScript; these types describe its JSON (outline.js, server.js).

/** Where a node stands: open (no tag), a claim of the agent's, or approved by the user. */
export type Status = 'open' | 'claim' | 'approved'

/** The `@` tags a node's heading line can carry, right after its number. */
export type Tag = 'approved' | 'claim' | 'options' | 'recommended' | 'current' | 'action' | 'ran'

/** A closing line of a node's text: `@Summary.`, `@Recommendation.` or `@Action.`, shown after its own tag. */
export interface ClosingLine {
    kind: 'summary' | 'recommendation' | 'action'
    /** Inline HTML. */
    html: string
}

/** A numbered heading of the outline and its text. A topic is a node of level 1. */
export interface OutlineNode {
    /** The full number path, as in the file: `2.1.3`. */
    num: string
    /** 1 for a topic, down to 6. */
    level: number
    tags: Tag[]
    /** The status in the file, from the node's own tags (a parent's rolled-up status is the page's to work out). */
    status: Status
    /** The title as plain text, for references. */
    title: string
    /** The title as inline HTML. */
    titleHtml: string
    /** The node's text as HTML, without its closing lines. */
    html: string
    /** Closing lines, in the order summary, recommendation, action. */
    closing: ClosingLine[]
    children: OutlineNode[]
}

/** An item of the queue: what the agent advises the user to handle next. */
export interface QueueItem {
    num: string
    kind: 'decide' | 'action' | 'approve' | 'read'
    label: string
}

/** GET /api/outline/<project>/<file>, and each event of its stream. */
export interface Outline {
    project: string
    /** The file name without `.md`. */
    file: string
    /** The `Title:` line: the outline session's name. Empty when the file has none. */
    title: string
    /** The `Resume:` line: a link or command that reopens the chat. */
    resume: string
    /** The `Model:` line, as written (`Claude Opus 5.5, high`). */
    model: string
    /** The `Terminal:` line: the linked session's tmux session. */
    terminal: string
    /** The `Session:` line: the linked session's id. */
    session: string
    /** The folder the linked session runs in, from its transcript. */
    folder: string
    /** Whether the Terminal tab can attach: the outline names a tmux session and the server can run terminals. */
    terminalTab: boolean
    /** HTML of any text before the first topic. */
    intro: string
    /** The topics. */
    nodes: OutlineNode[]
    queue: QueueItem[]
    /** The Markdown tab: the whole outline rendered as plain markdown. */
    markdown: string
}
