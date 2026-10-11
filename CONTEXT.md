# Live Discussion Outline

A local web app that mirrors work done with an agent (deciding, planning, coding, acting) into a numbered, collapsible outline the user can read, approve, and reply to.

## Language

**Outline session**:
One piece of work done with an agent (deciding, planning, coding or acting), mirrored into an outline. A term for code and docs only: the page shows outline sessions by their titles and never names the thing itself.
_Avoid_: Discussion, chat, conversation, thread, and a bare "session" (that is the agent's own)

**Outline**:
What is kept for an outline session and the page shows: its title, its nodes and its queue. Its mode says who writes it: the agent itself, or the server, which the agent then asks through operations. The user changes it through the page.
_Avoid_: Mirror, notes, file (the file is how an outline is stored, in both modes)

**Operation**:
One change an agent asks of an outline in server mode: add, update, move or remove a node, record what the user decided in chat, finish an action, acknowledge the user's ticks, post a message, or replace the queue.
_Avoid_: Edit, command, patch

**Map**:
An outline without its text: each node's number, title and what it is. In server mode the server hands it to the agent so the agent knows what the outline holds.
_Avoid_: Summary (that is a node's closing sentence), index

**Mode**:
Who writes an outline, fixed when its outline session starts: in **file mode** the agent writes the outline itself, following a skill; in **server mode** the server writes it and the agent sends operations. File mode is experimental, kept only while server mode replaces it.
_Avoid_: MCP mode (MCP is only how operations travel), markdown mode (both modes store markdown), legacy

**Title**:
The name of an outline session. The user gives it as the topic when starting the outline session, or else the agent gives it once the work has a subject; until then the outline has no title of its own and shows a placeholder. The user can rename it from the page.
_Avoid_: Name, heading (a heading is a node)

**Node**:
A numbered heading in an outline, together with its text (everything under it up to the next heading); nodes nest at most six levels deep.
_Avoid_: Bullet, item, row, point

**Topic**:
A top-level node.
_Avoid_: Section, point

**Bullet**:
A plain list item inside a node's text; it has no number and no status.
_Avoid_: Node, item

**Status**:
Where a node stands: **open** (no tag), an **agent claim**, or claim for short (the agent states it as settled or certain), or **user-approved** (the user approved it; only the user can make it so). The agent's wording of an answer the user gave is a claim until the user approves it: answering a question is not approving what the agent wrote down. An approval covers the wording the user saw: in server mode, when the agent rewrites an approved node, it is a claim again. A tick the user changed on the page is **pending** until the agent has taken it in: in file mode until the agent records it in the outline; in server mode, where it is recorded at once, until the agent acknowledges it. A node whose descendants all share a status takes that status too.
_Avoid_: Checkbox, resolved, agent-approved, done, and a bare "approved" (it does not say who approved), pending human approval (the human has approved; the agent has not recorded it)

**Question**:
A node that asks the user to choose exactly one of the options under it.
_Avoid_: Choice, poll, decision (a decide item is a queue item)

**Option**:
A child node of a question, shown with a letter; the agent may recommend one, and the user picks one, which answers the question.
_Avoid_: Alternative, answer, choice

**Summary**:
One sentence closing a long node that sums up that node's own text. It never answers a question; an answer changes the node's text or adds child nodes.
_Avoid_: Answer, conclusion, bottom line

**Outlines folder**:
The one folder outlines are kept in, with one subfolder per project. It is the Outline app's own storage, not the agent's. In file mode the agent writes there itself; in server mode only the server does.
_Avoid_: Dir, output folder

**Outline app**:
The Mac application that runs the server while it is open and shows outline sessions in one window of its own. Its name in the Dock and the Finder is **Outline Only**.
_Avoid_: Electron app, desktop app (that is Claude's own app)

**Settings file**:
The one file that says where the outlines folder is and how to reach the page; the app writes it, and the server and the agent's plugin read it. An agent in file mode learns from it where to write outlines.
_Avoid_: Config, preferences

**Project**:
The group an outline is filed under: the workspace's name when the outline session started from a workspace, else the working folder's name.
_Avoid_: Repo, folder

**Workspace**:
A named group of related folders an outline session covers, read from an editor's workspace file (Cursor's `.code-workspace`).
_Avoid_: Project, repo group

**Working folder**:
The one folder an agent session runs in; for a workspace, the folder that holds the workspace file, with the workspace's folders added alongside.
_Avoid_: Main repo, cwd

**Session**:
The agent's own record of its conversation, identified by a session id; it may be running or stopped.
_Avoid_: Chat, terminal

**Linked session**:
The session an outline records (its id, and its session terminal if it has one), so the page can show and reach the agent's conversation.

**Session terminal**:
The terminal the agent's session runs in, shared so that the user's own terminal and the page show the same screen.
_Avoid_: Console, shell

**Transcript**:
The agent's stored log of a session's messages and tool calls.
_Avoid_: History, log

**Queue**:
The agent's ordered list of outline items it asks the user to handle next: decisions first, then actions to run, then items to approve, then items to read. Each item is a **decide**, **action**, **approve** or **read** item. A **decide** item is a question the agent has not answered and has no recommendation for; a question with an option the agent recommends is an **approve** item, like any other claim.
_Avoid_: Tasks, to-do, cue

**Action**:
Something to do in the session itself (run tests, change code), kept as a node. The agent proposes it and carries it out only when the user runs it, or the user asks for it in chat and the agent carries it out at once. Once the agent has carried it out it is a **done** action, or a **failed** one when the agent tried and could not; a failed action can be run again.
_Avoid_: Play task, step, job

**Acknowledge**:
What the agent does about a tick the user changed on the page in server mode, once it has been told of it: any operation it sends afterwards acknowledges the tick, and the tick stops being pending. It is not the agent's word for an action it carried out: an action is finished.
_Avoid_: Confirm, record (that is for what the user decided in chat), finish (that is for actions)

**Message**:
A note from the agent about something the outline does not hold (a status, a warning); it may name the node it relates to. The outcome of something the agent did is not a message: it belongs to that action's node. In server mode the agent posts it as an operation; in file mode it writes it in its chat reply, tagged `@message`.
_Avoid_: Notification, reply, response

**Inbox**:
Where the page lists messages: the last ten for the whole outline session, or those of one node and its descendants.
_Avoid_: Mailbox, input box

**Tab**:
One of the page's top-level views of an outline session: Outline, Markdown, Terminal, or Transcript.
_Avoid_: View (that word already means table or bubbles inside the Outline tab), mode

**Terminal tab**:
The tab that shows the linked session's session terminal live and takes keyboard input into it.
_Avoid_: Chat tab, console

**Transcript tab**:
The tab that shows the linked session's transcript as rendered messages.
_Avoid_: Chat tab, chat view

**Viewer state**:
What the page remembers for the user about one outline (open nodes, what was read, undo steps, seen messages, the input box's draft, the tab shown, and in file mode the approvals still pending), kept by the server so every window on the outline shows the same.
_Avoid_: Local storage, preferences, settings (that is the settings file)

**Input box**:
The box fixed at the bottom of the window that types a message into the linked session's session terminal, whichever tab is shown; it is disabled while the Terminal tab is shown, since that tab takes typing itself.
_Avoid_: Message box, chat box, composer
