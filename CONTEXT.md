# Live Discussion Outline

A local web app that mirrors work done with an agent (deciding, planning, coding, acting) into a numbered, collapsible outline the user can read, approve, and reply to.

## Language

**Outline session**:
One piece of work done with an agent (deciding, planning, coding or acting), mirrored into an outline. A term for code and docs only: the page shows outline sessions by their titles and never names the thing itself.
_Avoid_: Discussion, chat, conversation, thread, and a bare "session" (that is the agent's own)

**Outline**:
The markdown file the agent keeps for an outline session, which the page shows.
_Avoid_: Map, mirror, notes

**Title**:
The name of an outline session, kept on the `Title:` line at the top of its outline; the agent writes it, and the user can rename it from the page.
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
Where a node stands: **open** (no tag), an **agent claim**, or claim for short (the agent states it as settled or certain), or **user-approved** (the user approved it; only the user can make it so). The agent's wording of an answer the user gave is a claim until the user approves it: answering a question is not approving what the agent wrote down. A node the user approved on the page is **pending** until the agent records the approval in the outline. A node whose descendants all share a status takes that status too.
_Avoid_: Checkbox, resolved, agent-approved, done, and a bare "approved" (it does not say who approved), pending human approval (the human has approved; the agent has not recorded it)

**Summary**:
One sentence closing a long node that sums up that node's own text. It never answers a question; an answer changes the node's text or adds child nodes.
_Avoid_: Answer, conclusion, bottom line

**Outlines folder**:
The one folder outlines are written to and read from, with one subfolder per project. The agent finds it on its own, so it can write outlines while nothing is serving them.
_Avoid_: Dir, output folder

**Outline app**:
The Mac application that runs the server while it is open and shows outline sessions in its own windows.
_Avoid_: Electron app, desktop app (that is Claude's own app)

**Settings file**:
The one file that says where the outlines folder is and how to reach the page; the app writes it, and the agent and the server read it. Without it the agent writes to a default outlines folder.
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
An outline item proposing something to do in the session itself (run tests, change code), which the agent carries out only when the user runs it; once the agent has carried it out it is a **done** action, or a **failed** one when the agent tried and could not; a failed action can be run again.
_Avoid_: Play task, step, job

**Message**:
A note the agent writes in its chat reply, tagged `@message`, about something the outline does not hold (the outcome of a request made in chat, a status, a warning); it may name the node it relates to.
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
What the page remembers for the user about one outline (open nodes, unsent approvals, what was read, undo steps, seen messages, the input box's draft, the tab shown), kept by the server so every window on the outline shows the same.
_Avoid_: Local storage, preferences, settings (that is the settings file)

**Input box**:
The box fixed at the bottom of the window that types a message into the linked session's session terminal, whichever tab is shown; it is disabled while the Terminal tab is shown, since that tab takes typing itself.
_Avoid_: Message box, chat box, composer
