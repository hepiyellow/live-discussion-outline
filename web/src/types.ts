// What the server sends the page. The server stays JavaScript; these types describe its JSON (outline.js, server.js).

/** Where a node stands: open (no tag), a claim of the agent's, or approved by the user. */
export type Status = 'open' | 'claim' | 'approved'

/** The `@` tags a node's heading line can carry, right after its number. */
/** The tags of a node, by the names the code uses: `@user-approved` is `approved`, `@agent-claim` is `claim`, `@action-done` is `action` and `ran`, `@action-failed` is `action` and `failed`. */
export type Tag = 'approved' | 'claim' | 'options' | 'option' | 'recommended' | 'current' | 'action' | 'ran' | 'failed'

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
    /** The letter of an option tagged `@option_A`; its title then starts with `(A)`. */
    option?: string
    /** The title as plain text, for references. */
    title: string
    /** The title as inline HTML. */
    titleHtml: string
    /** The node's text as HTML, without its closing lines. */
    html: string
    /** Closing lines, in the order summary, recommendation, action. */
    closing: ClosingLine[]
    /** The node's markdown with everything under it, for the copy button. Not in a history entry's nodes. */
    markdown?: string
    children: OutlineNode[]
}

/** One change of a node, from GET /api/outline/<project>/<file>/history?num=: when, and the node's subtree then. */
export interface HistoryEntry {
    at: number
    node: OutlineNode
    /** What the user did on the node then, from the approval log: the kind is the one the node had. */
    did?: { what: 'approved' | 'took-back' | 'picked' | 'ran'; kind: 'claim' | 'action' | 'done' | 'failed' | 'option' | 'plain' }[]
}

/** An item of the queue: what the agent advises the user to handle next. */
export interface QueueItem {
    num: string
    kind: 'decide' | 'action' | 'approve' | 'read'
    label: string
}

/**
 * Who writes an outline, fixed when its outline session starts: in file mode the agent writes the file itself, in server
 * mode the server writes it and the agent sends operations.
 */
export type Mode = 'file' | 'server'

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
    /** The `Mode:` line: `server` when it says so, else `file`. */
    mode: Mode
    /** The `Archived:` line: the day the user archived the outline. Empty when it is not archived. */
    archived: string
    /** Server mode: the nodes whose tick the user changed and the agent has not acknowledged yet. They show as pending. */
    unacked: string[]
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

/**
 * One undo step: every node whose tick a click changed, with its status in the outline before it. In file mode a node
 * also has its override as it was before the click (`had`: whether there was one, `was`: its value).
 */
export interface UndoStep {
    nodes: { num: string; had?: boolean; was?: boolean; file: Status }[]
    /** Nodes the click collapsed by completing them, opened again on undo. */
    collapsed: string[]
}

/** The viewer's state of one outline, kept by the server (state.js) and shared by every window on it. */
export interface ViewerState {
    /** Node number → whether the viewer opened (true) or closed (false) it. */
    open: Record<string, boolean>
    /** File mode: node number → the approval the viewer wants and the file does not show yet. */
    overrides: Record<string, boolean>
    /** File mode: node number → the override already sent to the session. */
    sent: Record<string, boolean>
    /** File mode: node number → 1 when an undo reopens a former claim, sent as "Back to claim". */
    backTo: Record<string, number>
    /** Node number → the node as the viewer last read it (`readVersion`), shown until they open the change. */
    read: Record<string, string>
    /** Node number → 1 once the viewer asked the agent to run that action. */
    runs: Record<string, number | string>
    /** Message id → 1 once seen in an inbox. */
    seen: Record<string, number>
    undo: UndoStep[]
    /** The input box's text. */
    draft: string
    /** References and removals waiting in the input box, sent as lines before its text. */
    chips: Chip[]
    /** The tab shown. */
    tab: TabName
}

/** The page's tabs: Outline, Markdown, Transcript and Terminal. */
export type TabName = 'outline' | 'md' | 'transcript' | 'term'

/**
 * A reference in the input box: its label (the node's number and title) and the line it sends. A `remove` chip is the
 * trash button's: it asks the agent to take the node out, and the box asks the user why.
 */
export interface Chip {
    label: string
    ref: string
    kind?: 'remove'
}

/** A message of the agent's: a `message` operation (agent.js), or an `@message` paragraph of its chat reply (transcript.js). */
export interface Message {
    id: string
    /** ISO time. */
    at: string
    /** The node it names, or ''. */
    num: string
    html: string
}

/**
 * A permission prompt of the outline's session that waits for the user (permission.js): Claude Code is about to use
 * `tool` and asks first. `summary` is what it asks in a line (the command, the file), `input` the tool's whole input
 * as JSON text.
 */
export interface PermissionPrompt {
    id: string
    /** ISO time. */
    at: string
    tool: string
    summary: string
    input: string
    /** The session's permission mode when it asked. */
    mode: string
}

/** A command the session can run, from GET /api/commands (commands.js). */
export interface SlashCommand {
    name: string
    hint?: string
    description?: string
    source: string
}

/** A change to the viewer state: map sections change single entries (null deletes one), the others are replaced. */
export type StatePatch = {
    [K in keyof ViewerState]?: ViewerState[K] extends Record<string, infer V> ? Record<string, V | null> : ViewerState[K]
}

/** An entry of the Transcript tab, from the outline's stream (transcript.js). */
export type TranscriptEntry =
    | { type: 'assistant-text'; html: string }
    /** A prompt (or a system line, such as a local command's output); `note` says how it arrived. */
    | { type: 'user-text'; text: string; note?: string; system?: boolean }
    /** A tool call: its input as JSON, clipped. */
    | { type: 'tool-use'; id: string; name: string; summary: string; input: string }
    /** The result of the tool call `toolUseId`. */
    | { type: 'tool-result'; toolUseId: string; text: string; error: boolean }
    /** The session's name: one set with /rename is custom and wins over the generated one. */
    | { type: 'title'; title: string; custom: boolean }

/** An outline in the list, from GET /api/outlines (server.js). */
export interface OutlineSummary {
    project: string
    file: string
    title: string
    /** Status counts over the nodes below the topics. */
    checkbox: { total: number; done: number; agent: number; open: number }
    /** Older outlines without status tags: emoji counts. */
    counts: { done: number; open: number; now: number }
    resume: string
    terminal: string
    session: string
    mode: Mode
    /** The day the user archived the outline; empty when it is not archived. The pane lists an archived outline under Archived only. */
    archived: string
    /** Last change, in ms since the epoch. */
    mtime: number
}

/** A session "New session" started whose outline has not appeared yet, from its tmux session (start.js startedSessions). */
export interface StartingSession {
    /** Its tmux session. */
    terminal: string
    project: string
    /** The topic typed in the dialog, or the project's name. */
    title: string
    /** When it started, in ms since the epoch. */
    started: number
}

export interface OutlineList {
    outlines: OutlineSummary[]
    starting: StartingSession[]
    /** The names of the workspaces New can start from: a project with one of these names is a workspace. */
    workspaces: string[]
    /** Whether this server can show terminals (node-pty loaded). */
    terminals: boolean
}

/** What "New session" can start from, from GET /api/start-options (start.js). */
export interface StartOptions {
    workspaces: { file: string; name: string; folders: { name: string }[] }[]
    /** `mode`: the mode of the outline that links to the session, when one does; resumed, the session keeps it. */
    sessions: { id: string; mtime: number; cwd: string; title: string; openIn?: { app: string; pid?: number; tmux?: string }; mode?: Mode }[]
}

/** A folder and its subfolders, from GET /api/dirs. */
export interface DirListing {
    path: string
    parent: string
    repo: boolean
    dirs: { name: string; repo: boolean }[]
}
