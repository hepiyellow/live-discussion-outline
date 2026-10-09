# Live Discussion Outline

A local web app that mirrors an agent conversation into a numbered, collapsible outline the user can read, approve, and reply to.

## Language

**Discussion**:
One agent conversation that is being mirrored into an outline.
_Avoid_: Chat, conversation, thread

**Outline**:
The markdown file the agent keeps for a discussion, rendered by the server as the page.
_Avoid_: Map, mirror, notes

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
Where a node stands: **open** (no tag), a **claim** (the agent states it as settled or certain), or **approved** (the user approved it). A node whose descendants all share a status takes that status too.
_Avoid_: Checkbox, resolved, agent-approved, done

**Summary**:
One sentence closing a long node that sums up that node's own text. It never answers a question; an answer changes the node's text or adds child nodes.
_Avoid_: Answer, conclusion, bottom line

**Project**:
The group an outline is filed under: the workspace's name when the discussion started from a workspace, else the working folder's name.
_Avoid_: Repo, folder

**Workspace**:
A named group of related folders a discussion covers, read from an editor's workspace file (Cursor's `.code-workspace`).
_Avoid_: Project, repo group

**Working folder**:
The one folder an agent session runs in; for a workspace, the folder that holds the workspace file, with the workspace's folders added alongside.
_Avoid_: Main repo, cwd

**Session**:
The agent's own record of a discussion, identified by a session id; it may be running or stopped.
_Avoid_: Chat, terminal

**Linked session**:
The session an outline records (its id, and its session terminal if it has one), so the page can show and reach that discussion.

**Session terminal**:
The terminal the agent's session runs in, shared so that the user's own terminal and the page show the same screen.
_Avoid_: Console, shell

**Transcript**:
The agent's stored log of a session's messages and tool calls.
_Avoid_: History, log

**Queue**:
The agent's ordered list of outline items it asks the user to handle next: decisions first, then actions to run, then items to approve, then items to read. Each item is a **decide**, **action**, **approve** or **read** item.
_Avoid_: Tasks, to-do, cue

**Action**:
An outline item proposing something to do in the session itself (run tests, change code), which the agent carries out only when the user runs it; once done it is a **ran** action.
_Avoid_: Play task, step, job

**Message**:
A note the agent writes in its chat reply, tagged `@message`, about something the outline does not hold (the outcome of a request made in chat, a status, a warning); it may name the node it relates to.
_Avoid_: Notification, reply, response

**Inbox**:
Where the page lists messages: the last ten for the whole discussion, or those of one node and its descendants.
_Avoid_: Mailbox, input box

**Tab**:
One of the page's top-level views of a discussion: Outline, Markdown, Terminal, or Transcript.
_Avoid_: View (that word already means table or bubbles inside the Outline tab), mode

**Terminal tab**:
The tab that shows the linked session's session terminal live and takes keyboard input into it.
_Avoid_: Chat tab, console

**Transcript tab**:
The tab that shows the linked session's transcript as rendered messages, with an input box that types a message into the session terminal.
_Avoid_: Chat tab, chat view
