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
One change an agent asks of an outline in server mode: add, update, move or remove a node, record what the user decided in chat, finish a task, acknowledge the user's ticks, post a message, or order the queue.
_Avoid_: Edit, command, patch

**Map**:
An outline without its text: each node's number, title and what it is. In server mode the server hands it to the agent so the agent knows what the outline holds.
_Avoid_: Summary (that is a node's closing sentence), index

**Mode**:
Who writes an outline, fixed when its outline session starts: in **file mode** the agent writes the outline itself, following a skill; in **server mode** the server writes it and the agent sends operations. File mode is experimental, kept only while server mode replaces it.
_Avoid_: MCP mode (MCP is only how operations travel), markdown mode (both modes store markdown), legacy

**Mechanical skill**:
The skill that tells an agent how an outline works, the same for every user: the user reads the outline and not the chat, what a node, a question and a task are, how the agent changes the outline, and what only the user may do. A rule belongs to it when breaking it would make the page say something false, or stop it working; the server may refuse such a breach.
_Avoid_: Core skill, base skill, protocol

**Workflow skill**:
A skill that tells an agent how this user wants to work with an outline: when to ask for the user and when not, whether tasks wait to be run, how hard to question a design before acting. It is the user's to choose or to write, and the server enforces none of it. An outline session has one, recorded with its outline and shown on the page: the one the user named, else the plugin's default.
_Avoid_: Template (a template is a workflow skill the plugin suggests), settings, preferences

**Title**:
The name of an outline session. The user gives it as the topic when starting the outline session, or on the page afterwards; else the agent gives it once the work has a subject. Until then the outline is **untitled**: it has no title of its own, and the page shows the placeholder "Untitled" with the field that names it. The user can rename it from the page at any time. A title the user gives on the page is also given to the linked session, as that session's own name.
_Avoid_: Name, heading (a heading is a node)

**Node**:
A numbered heading in an outline, together with its text (everything under it up to the next heading); nodes nest at most six levels deep.
_Avoid_: Bullet, item, row, point

**Topic**:
A top-level node.
_Avoid_: Section, point

**Bullet**:
A plain list item inside a node's text; it has no number, no kind and no approval.
_Avoid_: Node, item

**Kind**:
What a node is on the agent's side: plain (the agent takes no stance), an **agent claim**, or claim for short (the agent states it as settled or certain), an unresolved question, an option, or a task (proposed, done or failed). A question with a recommended option is a claim. The page shows a node's kind as its **kind mark**. A task's kind mark is a checkbox, ticked once the agent has done the task: that tick is the agent's word that the task is done, and never an approval, which a task does not take. A node has one kind: it is never a claim and a task at once, and the task that follows from a claim is a node of its own beside it. A parent other than a question has no kind of its own: the kinds found under it show beside it. On every row the kind marks are at the right of the title, and none stands at its left: a node's own kind, when it has one, and on a parent also the kinds found under it, each with how many nodes under the parent have it. They are drawn in one column for each kind, in a fixed order, the same for every row in view (a row is in view when every parent above it is open), and a column exists only for a kind that some row in view shows. A claim the user approved is a kind of its own in this.
_Avoid_: Status, type, state

**Approval**:
The user's own mark on a node, shown by the tick in its box. It is the only tick the user gives: the tick in a task's checkbox is the agent's. A node that has it is **user-approved**; only the user gives it or takes it back, and nothing requires it. Giving it is an action. It says the user concurs with a claim, or accepts a plain node as it reads. A task takes no approval: the user runs it, and reads what came of it. The agent's wording of an answer the user gave is a claim until the user approves it: answering a question is not approving what the agent wrote down. An approval covers the wording the user saw: in server mode, when the agent rewrites an approved node, it is a claim again. A tick the user changed on the page is **pending** until the agent has taken it in: in file mode until the agent records it in the outline; in server mode, where it is recorded at once, until the agent acknowledges it. A parent's box follows the approvals under it: all of them, some, or none.
_Avoid_: Status, checkbox, resolved, agent-approved, done, and a bare "approved" (it does not say who approved), pending human approval (the human has approved; the agent has not recorded it)

**Action log**:
The record of the user's actions on each node of an outline in server mode, in order: approved it, took the approval back, picked it, ran it, each with the kind and the wording the node had then. Nothing is taken out of it, and it follows a node when numbers shift. The node's history shows it.
_Avoid_: Approval log (it holds picks and runs too), audit log, undo history (undo is the viewer state's steps)

**Question**:
A node that asks the user to choose exactly one of the options under it. When the agent recommends one of them it is a claim, a fuller one that also shows what the agent chose not to claim, and it waits for the user like any other claim. Without a recommendation it is an **unresolved question**: the agent cannot decide, or leaves the decision to the user, and it is the one kind of node that needs the user. Something the agent asks and answers itself, with no options to show (a yes or no), is not a question but a claim, however it is phrased.
_Avoid_: Choice, poll, decision (a decide item is a queue item)

**Option**:
A child node of a question, shown with a letter; the agent may recommend one, and the user picks one, which answers the question. The user picks it with the **pick button**, which stands first in the option's text with a line that says what a click does; nothing left of a title picks an option. Once picked, the button says so and a click takes the pick back, picking another option moves the pick, and the option's row shows the user's tick at its right.
_Avoid_: Alternative, answer, choice

**Summary**:
One sentence closing a long node that sums up that node's own text. It never answers a question; an answer changes the node's text or adds child nodes.
_Avoid_: Answer, conclusion, bottom line

**Outlines folder**:
The one folder outlines are kept in, with one subfolder per project. It is the Outline app's own storage, not the agent's. In file mode the agent writes there itself; in server mode only the server does.
_Avoid_: Dir, output folder

**Archived**:
An outline session the user put aside: the pane lists it under Archived, not in its project's group. Nothing else about it changes: its outline, its link and its linked session work as before (the session keeps running), and it stays archived until the user unarchives it.
_Avoid_: Hidden, closed, done (that is a task), deleted

**Trash**:
Where an outline goes when the user deletes it from the pane: it is no longer an outline the page knows, and is kept in the outlines folder until moved back by hand. Deleting also ends the outline session's work: the session terminal the app started for it is ended, and with it the linked session, whose transcript stays. That is how it differs from archiving, which leaves the linked session running.
_Avoid_: Archive, remove (that is for a node)

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

**Action**:
Something the user does on a node of the outline: approve it, pick an option, run a task, or read it. Only the user acts in this sense: what the agent does is a task. The agent never performs one. It can ask for an approval, on the node; the other actions a node waits for follow from what the node is (a pending action).
_Avoid_: Task (that is the agent's), and "action" for anything the agent does

**Task**:
Something for the agent to do in the session itself (run tests, change code), kept as a node. The agent proposes it and carries it out only when the user runs it, or the user asks for it in chat and the agent carries it out at once. Once the agent has carried it out it is a **done** task, or a **failed** one when the agent tried and could not; a failed task can be run again. A task takes no approval.
_Avoid_: Action (that is the user's), play task, step, job

**Pending action**:
An action a node waits for the user to perform: to pick an option of a question the agent has no recommendation for, to run a task (a proposed one, or one that failed), or to approve a claim whose agent asked for that. Nothing requires an approval, so a claim waits for one only when its agent asked.
_Avoid_: Open item, to-do, and a bare "pending" (that is a tick the agent has not taken in)

**Action queue**:
The pending actions of an outline, in order, queue for short. In server mode the server lists them from the nodes and the agent only orders them, most important first; one the agent has not placed yet comes last. Each item is an action indicator for one node, and says which action it is: **decide** (pick an option of a question the agent has no recommendation for), **run** (a task) or **approve** (a claim whose agent asked for the user's approval, a question with a recommended option included). An item does nothing but show the user where the action is: the action itself is done on the node. It leaves the queue when the user performs the action, or when the agent changes the node so that it asks nothing more. An agent cannot put a node in the queue to have it read: that is what a change indicator is for. An agent in file mode still writes the queue itself, and may list a node to **read**.
_Avoid_: Task queue, tasks (those are the agent's), to-do, cue

**Pending change**:
A change the agent made to a node that the page holds back until the user opens it, so that the outline does not change under them. A node that was reworded, or whose kind changed, keeps what the user read; a node that was added is a bare row; a node that was removed stays where it stood, struck through, while the nodes after it carry their new numbers. Opening a node's pending change opens every one under it. What the user does is never one: their approval or pick applies at once. Nothing is pending on a first visit.
_Avoid_: Update, unread (the code's word), diff (that is the icon), and a bare "pending"

**Diff icon**:
The one icon left of a node's title: it says the node has a pending change, and a click opens it. A plus over a minus for a node that changed, a plus for one that was added, a minus for one that was removed. A closed parent shows it for the pending changes under it.
_Avoid_: Envelope, unread mark

**Change indicator**:
What shows the user where a pending change is, without opening it: an item of the lower queue of the page's column, under the action queue. It is drawn with what opening the change brings: the node's new kind mark, or else the diff icon in the form the node has. The page lists them, as the outline is ordered or the oldest change first, as the user chooses; no agent orders them. A node that has an item in the action queue has none: that item leads to the same node.
_Avoid_: Notice, update message (a message is a note in the inbox), notification

**Action indicator**:
What shows the user where an action is, without performing it: a click takes them to the place on the node where the action is done, and nothing else. An item of the action queue is one. So is the empty checkbox among the kind marks of a title row, for a task that is proposed (the node's own, or one found under a parent): it does not run the task or tick the box, and takes the user to the task's own button, in the text of the first such node, by scrolling that button into view and making it grow and shrink once.
_Avoid_: Play button, run button

**Acknowledge**:
What the agent does about a tick the user changed on the page in server mode, once it has been told of it: any operation it sends afterwards acknowledges the tick, and the tick stops being pending. It is not the agent's word for a task it carried out: a task is finished.
_Avoid_: Confirm, record (that is for what the user decided in chat), finish (that is for tasks)

**Message**:
A note about something the outline does not hold; it may name the node it relates to. The agent posts one for a status or a warning. In server mode the server also posts two kinds by itself, taken from the session: the agent's reply of a turn that changed nothing in the outline, and the output of a local command. The outcome of something the agent did is not a message: it belongs to that task's node. In server mode the agent posts a message as an operation; in file mode it writes it in its chat reply, tagged `@message`.
_Avoid_: Notification, response, and "reply" for the message itself (a reply is what the agent says in chat at the end of a turn; it may become a message)

**Permission prompt**:
Claude Code asking the user whether a tool may be used, before it uses it. The session's terminal shows it as a dialog, and in server mode the outline's page shows it as a pop-up; the user answers in either place, with **allow** or **deny**, and the first answer counts. A prompt the user dismisses on the page is left to the terminal.
_Avoid_: Approval (that is the user's tick on a node), accept question, confirmation

**Local command**:
A command Claude Code runs itself, without a turn of the agent, such as `/context` or `/model`. The agent neither sees it run nor answers it, so only the session's transcript shows it; in server mode its output becomes a message.
_Avoid_: Slash command (skills are slash commands too, and those go to the agent), built-in

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
What the page remembers for the user about one outline (open nodes, what was read, undo steps, seen messages, the input box's draft, the tab shown, the order of the change indicators, and in file mode the approvals still pending), kept by the server so every window on the outline shows the same.
_Avoid_: Local storage, preferences, settings (that is the settings file)

**Input box**:
The box fixed at the bottom of the window that types a message into the linked session's session terminal, whichever tab is shown; it is disabled while the Terminal tab is shown, since that tab takes typing itself.
_Avoid_: Message box, chat box, composer
