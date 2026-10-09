# Live Discussion Outline

A local web app that mirrors an agent conversation into a numbered, collapsible outline the user can read, approve, and reply to.

## Language

**Discussion**:
One agent conversation that is being mirrored into an outline.
_Avoid_: Chat, conversation, thread

**Outline**:
The markdown file the agent keeps for a discussion, rendered by the server as the page.
_Avoid_: Map, mirror, notes

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

**Tab**:
One of the page's top-level views of a discussion: Outline, Markdown, Terminal, or Transcript.
_Avoid_: View (that word already means table or bubbles inside the Outline tab), mode

**Terminal tab**:
The tab that shows the linked session's session terminal live and takes keyboard input into it.
_Avoid_: Chat tab, console

**Transcript tab**:
The tab that shows the linked session's transcript as rendered messages, with an input box that types a message into the session terminal.
_Avoid_: Chat tab, chat view
