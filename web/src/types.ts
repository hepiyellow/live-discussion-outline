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

/** One undo step: every node a click changed, as it was before (its override, and its status in the file). */
export interface UndoStep {
    nodes: { num: string; had: boolean; was: boolean; file: Status }[]
    /** Nodes the click collapsed by completing them, opened again on undo. */
    collapsed: string[]
}

/** The viewer's state of one outline, kept by the server (state.js) and shared by every window on it. */
export interface ViewerState {
    /** Node number → whether the viewer opened (true) or closed (false) it. */
    open: Record<string, boolean>
    /** Node number → the approval the viewer wants and the file does not show yet. */
    overrides: Record<string, boolean>
    /** Node number → the override already sent to the session. */
    sent: Record<string, boolean>
    /** Node number → 1 when an undo reopens a former claim, sent as "Back to claim". */
    backTo: Record<string, number>
    /** Node number → the node as the viewer last read it (`readVersion`), shown until they open the change. */
    read: Record<string, string>
    /** Node number → 1 once the viewer asked the agent to run that action. */
    runs: Record<string, number>
    /** Message id → 1 once seen in an inbox. */
    seen: Record<string, number>
    undo: UndoStep[]
    /** The input box's text. */
    draft: string
}

/** A change to the viewer state: map sections change single entries (null deletes one), the others are replaced. */
export type StatePatch = {
    [K in keyof ViewerState]?: ViewerState[K] extends Record<string, infer V> ? Record<string, V | null> : ViewerState[K]
}
