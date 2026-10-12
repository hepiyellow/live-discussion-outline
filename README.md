# Live Discussion Outline

**A working interface that keeps the whole conversation inside human attention — and it's already replaced my chat.**

An agent can hold a million tokens and attend to all of them at once. You can hold a handful of things. So in a long session with a coding agent, the bottleneck is not the model, it is you: you lose the thread, forget what was decided three topics ago, and scroll back up to find the one answer you need while the chat keeps growing below you.

This is not a companion to the chat. It replaces it. The agent keeps a numbered, collapsible outline of the work as it goes (topics, claims, decisions, what is still open) and you live in that outline: you read it, approve nodes, pick options, run actions and type your next message, all from the page. The transcript is still there, one tab away, for the rare time you need it.

I have been building and using it for a few days, and it has already replaced the chat for me completely. It feels cognitively different: lighter, calmer, easier to think in.

## Why the agent writes it

Tools that visualize a conversation read the transcript after the fact and redraw it: a tree of messages, a nicer chat window. They work with any chat, and the agent never knows they exist. But a transcript only holds what was said. It cannot tell which points are settled, which are claims waiting for your approval, what needs a decision, or what can be folded away. Only the agent understands the work well enough to know that.

So here the agent is asked (by a skill, or a rules file) to maintain the outline as part of its job. That costs some tokens on every turn. In return you get something no transcript reader can produce: a curated, human-sized map of the work, a **comprehension layer** between an agent that has all the information and a person who needs to understand it.

## Continuity of understanding

The agent moves at machine speed. Your understanding has to update at human speed: one thing at a time, never in a sudden jump. Every part of the page follows from that one rule.

- **The outline.** Detail is folded away and you open only what you are looking at. The relief does not come from seeing everything at once (no one can), but from not having to.
- **The queue.** The outline is the map of what has happened; the queue is the pointer to what comes next. At the end of each turn the agent triages everything still open and lists, in order, what needs you: decide this, run that, approve this, read that.
- **The approval loop.** Ticking a node or picking an option reaches the agent from the page: recorded in the outline at once and told to the agent a few seconds after your last tick, as one line typed into its session (server mode; a session that does not run in tmux is told with your next message), or sent into the agent's session as a line such as `Approved in the outline: …` (file mode). Steering happens where you read.
- **A view that holds still.** The agent rewrites the outline constantly, but your scroll position and what you have open never jump. Your sense of where things are stays valid.
- **Change shown as motion.** When the agent rewrites a node you have already read, the page keeps showing what you read and marks it with a diff icon. Only when you click does it animate the old text into the new, word by word. People cannot diff two states in their heads; they can follow a change as it happens.

## How it works

An outline is a markdown file in the outlines folder, and it has one writer. Who that is depends on the outline's **mode**, which is fixed when its session starts.

### Two modes

| | **Server mode** | **File mode** |
|---|---|---|
| Who writes the file | The server. The agent sends operations through three MCP tools. | The agent, following a skill. The server only watches the folder. |
| Start it with | `/outline-only:outline` | `/outline-only:outline-file` |
| A tick on the page | Is recorded in the outline at once, and shows as pending (its box fades out and in) until the agent acknowledges it. The agent is told about five seconds after your last tick, by a line typed into its session; without a session terminal, with your next message. Its next change to the outline acknowledges the tick. | Is sent into the agent's session and shows as pending until the agent records it in the file. |
| The rules (unique numbers, roll-up, the current node, the queue) | The server keeps them, and refuses a change that breaks one. | The skill asks the agent to keep them. |
| What the agent needs | The plugin: its tools, its skill and its hooks. | To be able to write a file. |

Both modes are here for a transition: server mode is the newer one ([ADR 0003](docs/adr/0003-the-server-owns-the-outline.md)) and is being tried on real sessions, with file mode as the fallback. One of them will be retired ([the plan](docs/plans/two-modes.md)).

**Choosing a mode.** From the page, **New** offers both, with server mode selected. In a chat you started yourself, you choose by the command you type. The mode is written in the outline's file as a header line, `Mode: server`; a file without that line is in file mode. An outline keeps its mode: resuming its session from the page keeps it too, and the page does not change it.

### The parts

1. **A plugin for the agent** ([`plugin/`](plugin)): two skills, one per mode, three MCP tools (`start`, `read`, `change`) and three hooks.
   - **In server mode** there are two skills. `outline`, the one you invoke, holds the mechanics, the same for everyone: that you read the outline and not the chat, what a node, a claim, a question and an action are, that only you approve. It has the agent load a **workflow skill**, which holds how you want to work: when the agent asks for you and what it puts in the queue, whether actions wait for Run, how the work is mirrored. The plugin's `outline-workflow` is the default; a workflow skill of your own, an ordinary skill you name when you start the outline or later, replaces it. The outline records which one it has, as a header line `Workflow: <skill>`, so a resumed session keeps it and the agent is told it again after compaction. The server enforces the mechanics and none of the workflow. The tools carry the changes. Hooks hand the agent what you did on the page with each prompt, and the outline's map after compaction or resume; a third holds a turn open once when the agent ends it without acknowledging ticks it was told of.
   - **In file mode** the skill also holds the file's format and its rules, and the agent uses none of the tools.
   - **The third hook is a guard**: it refuses a write by the agent's file tools to an outline in server mode. It does not see writes made through the shell.
2. **A small local server.** In server mode it is the only thing that writes the outline: it keeps numbers unique, rolls statuses up, marks the current node, keeps the queue's kinds right, and refuses a change that breaks a rule, saying why. In file mode it never writes the outline, except to rename it.
3. **The page**, served at `http://localhost:4577`: it collapses and expands nodes and updates in place on every change. It reads and shows an outline the same way in both modes.

It is built and used day to day with Claude Code, which gets the most out of it (the Terminal and Transcript tabs, the input box). In file mode any agent that can write a file can keep an outline; in server mode, any agent that can run a stdio MCP server. See below.

![A rendered outline: collapsed resolved topics, the 🔥 topic highlighted, and three levels of nesting](docs/screenshot.png)

The example in [`examples/demo/rate-limiting.md`](examples/demo/rate-limiting.md) is the markdown behind this screenshot.

## Features

- Every point and sub-point is numbered with its full path (`1`, `1.1`, `2.3.1`), in the chat and in the page, so "2.1" means the same thing in both places.
- Every point is a **node**: a numbered heading (`# 2. Topic`, `## 2.1 Title`, down to six levels) plus its text, which is ordinary markdown, plain bullets included. Status and other tags sit on the heading line after the number. The node under discussion carries an `@current` tag; the page draws an orange line on it and on every ancestor on its path. Approved topics start collapsed.
- A pane on the left of every page lists all outlines, grouped by project like Claude's sidebar: workspaces first (a project named like a `.code-workspace` file that New can start from), then single folders, each group by its latest change and its outlines newest first. A search box at its top filters it (every word must appear in the title or the project), **New** under it starts a session from any page, and a session just started shows as a row with a spinner until its outline appears. Hovering a row shows its rename pencil, archive button and trash button; the outlines you archived are in one group under the others, **Archived**. Drag the pane's right edge to resize it (double-click resets it); `/` shows only the pane.
- **Resume later:** an outline can carry a `Resume:` line (a link or command that reopens the chat it came from). The page has a **Copy chat link** button, so you can find a paused discussion and reopen its chat. See `resumeTemplate` below.
- A **Markdown** button at the top switches to the plain rendered markdown (a normal preview, nothing collapsible) and back; the choice is remembered per outline.
- The discussion's title (the outline's `Title:` line) shows in the top bar. To rename it, hover its row in the pane and click the pencil: type a new name, press Enter to save or Escape to cancel.
- Nodes below a topic show as chat-style bubbles, one level of nesting inside another: number (last segment, full path on hover), title and text. Click anywhere on a parent row (outside its checkbox and buttons) to collapse or expand it; the circled number next to the side-chat button counts its direct children and fills in while the row is collapsed. Hovering a node also shows a trash button: it puts the node in the message box as a tag with a trash icon, and the box asks why it should be removed; sending it sends `Removed from the outline: <path and name>` and your reason, and the agent takes the node out. Without a linked session it copies that line to paste into the chat.
- Each row has its approval box at the left of its title and its kind marks at the right of it. They are drawn from the node's tags (`@agent-claim`: the agent's claim, `@user-approved`: you approved it, `@action`, `@action-done`, `@action-failed`; the tags name who, and the older `@claim` and `@approved` still read the same). The **kind mark** says what the node is on the agent's side, and is not a control: a blue sparkle for a claim (the agent stands behind it), a yellow play triangle for an action (outlined when proposed, with a ring turning around it while the agent runs it, filled once the agent carried it out, struck through in red when it failed), a red question mark for an unresolved question (options with none recommended: the agent needs you), which turns grey once you answered. A question with a recommended option is a claim, and has the sparkle. A node with no stance has no mark. The triangle of an action is its **action indicator**: it runs nothing, and a click on it shows the button in the node's text that does (it grows and shrinks once). The **approval box** says only whether you approved the node: empty, or an outlined tick (no checkbox is filled). The tick is yours alone: a claim, a recommended option and an action the agent carried out have an empty box until you tick it; an action done that you approved shows its filled yellow triangle beside the tick. A parent's box rolls up the approvals under it: ticked when you approved everything there, a dash when you approved some of it, empty when none; the kind marks at the right of its row, as outlined bubbles, are its own kind (a parent has no kind mark at its left) and the kinds found under it, each a button to the first node of that kind with how many there are when more than one (a ring turns on an action under it that is running). The bubbles stand in one column for each kind, in a fixed order (claim, claim you approved, question, answered question, action, done, failed) and the same for every row in view, so that with everything collapsed they line up one under the other; a kind that no row in view shows has no column. The reference, copy, history and trash buttons are at the far right of the row, as on a topic. When nothing under a parent is open any more (every node is a claim, approved or done, and every question is answered or has a recommendation) it is settled, and it collapses as soon as the change arrives. Ticking a parent also ticks every descendant. Ticking an empty box approves the node. Only a row whose node is in the queue calls for you: there an empty box is drawn in full, and elsewhere it is faint, there to be ticked and asking nothing. In server mode the server writes the approval into the outline at once; the agent learns of it with your next message and in the result of its next change, and is not interrupted; when the agent later rewrites a node you approved, the node is its claim again until you approve the new wording. In file mode the tick fades to half and back (pending) until the agent records it in the file: with a linked session the page sends `Approved in the outline: …`, `Reopened in the outline: …` or `Chosen in the outline: …` into it by itself (clicks within about a second go as one message), and without one it copies that text to the clipboard and lists the approvals not copied yet in a bottom bar with a **Copy to clipboard** button. A node tagged `@options` with child option nodes is a single choice (each option is tagged with its letter, `@option_A`, `@option_B`, which the page shows as `(A)`, `(B)` before the title; older outlines type the letter into the title): it shows a "◉ Pick one" tag, its options render as radio buttons (choosing one clears the others and answers the question), and the option tagged `@recommended` shows the sparkle and a Recommended tag. `@options` on a leaf shows a red "❓ Options" tag. `@Recommendation.` in the node's text puts a Recommendation tag, with the sparkle, in the content cell, below the explanation and immediately before the recommendation, in that same cell, and makes the node a claim.
- Page bar: the tabs, then expand all, collapse all, and jump to the current node. Which items you opened or closed is kept per outline by the server.
- **Terminal tab:** if the agent runs inside [tmux](https://github.com/tmux/tmux), the outline records the tmux session (`Terminal:` line) and the page gets a tab that shows that session's live terminal ([xterm.js](https://xtermjs.org)). Your own terminal and the page are two views of the same session: type in either. Start the agent with `tmux new -s <name> claude` (any agent works), then invoke the skill. The server sets `mouse on` for that tmux session so scrolling and clicks reach the agent.
- **Transcript tab:** with Claude Code, the outline also records the session id (`Session:` line) and the page gets a tab that renders the session's transcript as messages (your prompts, Claude's answers as markdown, tool calls collapsed with their input and output), updated live. It reads Claude Code's own log under `~/.claude/projects`, an internal format that may change. When the outline also has a `Terminal:` line, an input box at the bottom types your message into the tmux session as if you typed it there (Enter sends, Shift+Enter adds a line). Without tmux, for example in the desktop app, the tab is read-only.
- **Message box:** when the outline has a `Terminal:` line, a box at the bottom of the Outline, Markdown and Transcript tabs (one box, one draft) types your message into the session. On such a page each row's button adds a chip for that item to the message box, sent as a `Re: outline …` line before your text. Without a session, a row's button copies its reference instead.
- **Slash commands:** typing `/` at the start of the message box lists the commands the session can run, filtered as you type (arrows move, Tab or Enter completes, Esc closes): the skills the session itself lists (read from its transcript), user-only skills and commands from `~/.claude` and the project's `.claude` folder, and a short list of Claude Code built-ins, which may lag behind new versions. Commands that open a picker (`/resume`, `/config`, `/model` with no argument) show it in the Terminal tab.
- **Model and effort:** the dropdowns at the top right start from the outline's `Model:` line; changing one types `/model` or `/effort` into the session. Claude Code also saves that choice as your default for new sessions.
- **New session:** New, on the outline list and on every page, starts a session in tmux from a Cursor workspace, a folder, or a past Claude Code session (resumed), in the mode you choose in the dialog (server mode is selected; a past session that already has an outline keeps that outline's mode), with the plugin loaded and that mode's skill as the first message. In server mode the server writes the session's outline at once and the page opens it, empty: a topic is optional, the agent asks for none, and you write your first message in the input box; the agent names the outline once the conversation has a subject. In file mode the page shows that session's terminal in the main area until the agent writes the outline's first version, then opens the outline. Workspace files are looked for beside the folders your recent sessions ran in; set `workspaceDirs` to search elsewhere.
- **Resuming a session open elsewhere:** the Resume tab marks sessions still running in another app ("open in Cursor", "open in tmux session …"). Starting one that runs in Cursor, VS Code, the desktop app or another terminal offers to stop it there first, since two apps writing one session conflict; one already in tmux is opened instead. A session started fresh with nothing running under it can go unnoticed.
- **Done parents collapse:** when your click approves the last open descendant of a node, or picks an option, that node collapses over half a second and the page scrolls it to the top, just below the sticky headers above it. It does not wait for the agent. If the click completes several levels at once (up to the topic), the outermost one animates and the inner ones close with it; undo opens them again.
- **What you did on a node:** in server mode the server keeps a log of your actions, per outline, in `.approvals/` of the outlines folder: each approval, each approval taken back, each pick and each press of Run, with the kind the node had and the wording you saw. A node's history (its clock button, on hover) says it under the time it happened at: "You approved this claim", "You took your approval back", "You picked this option", "You ran it". A node is a claim or a task, never both, and a task takes no approval: you run it, and read what came of it.
- **Undo:** the undo button in the page bar, or ⌘Z outside a text field, takes back your last approval click: a node's or topic's checkbox, or an option pick. Every node that click changed goes back to its own previous state, so approving a parent over mixed children and undoing it restores each child as it was. In server mode the outline is put back at once, and a claim you had approved is a claim again. In file mode what was already sent is sent back as `Reopened in the outline: …`, `Chosen in the outline: …` (the option picked before), or `Back to claim in the outline: …` for nodes that were the agent's claims. Steps are kept per outline by the server, up to 50.
- **Queue:** the agent ends the outline with a `# @queue` section listing, by priority, the items it advises you to handle next (`- 2.1.3 @decide …`, `@approve`, `@read`). The page shows them in a column in the Outline tab's left margin, beside the nodes they point at; items that arrive slide in from the right, and those that do not fit are counted on an ellipsis that lists them. Clicking one opens and highlights that item in the Outline tab. The node carries the same icon as its item, left of its checkbox, so the two are recognized as one: a red question mark for `@decide` (a question the agent has no recommendation for; the page shows a `@decide` item as `@approve` when its node already holds the agent's recommendation, such as a question with a `@recommended` option), a blue circled tick for `@approve` (a claim or recommendation of the agent's, a question with a recommended option included), an eye for `@read`; an action's icon is its play button. A task the agent already carried out can be in the queue too, as `@read`: in server mode the queue holds exactly what the agent puts in it, and a task takes no approval. An item and its icon disappear as soon as you approve or pick it on the page, and the agent rewrites the queue after each answer. Node numbers must be unique: the page warns when two nodes share one, since an approval of one would reach the other.
- **Actions:** the agent tags nodes that propose something to do in the session (run tests, change code) `@action`. Such a node ends with an `@Action.` line, and the red "Action" tag that opens that line is the button that runs it (an action without the line gets the button on a line of its own). Pressing it types `Run in the outline: …` into the session's terminal (without one, the agent is told with your next message in server mode, and the line is copied for you to paste in file mode); a red ring turns in the button until the agent has done it and marks the node `@action-done` (or `@action-failed`, which shows a red "Failed" tag beside a "Run again" button). The node then shows as changed, and opening the change turns its "Action" button into a yellow "Done" tag (a done action without an `@Action.` line carries the tag on its title). The red triangle left of the node's checkbox shows while the action is in the queue, and runs nothing: a click on it opens the node and makes the button pulse, as the diff button leads to the diff. Picking an action option puts it in the queue (`@action`, a red play icon) rather than running it.
- **Closing lines:** a long node's text ends with `@Summary.` (one sentence summing up that text; answers go into the text itself or into child nodes, never into the summary), then `@Recommendation.`, then, on an action, `@Action.` (what running it will do). Each shows on its own line after a Summary, Recommendation (with the claim's sparkle) or ▶ Action tag.
- **Working spinner:** left of the message box, it spins while the agent is in a turn: on as soon as the page sends something, off when the session's transcript records the end of the turn (needs the `Session:` line).
- **Messages:** for things it does not put in the outline (the outcome of a build or test you asked for in chat, a status), the agent posts a message, optionally naming a node: in server mode with its `change` tool, in file mode as a paragraph of its chat reply that starts with `@message`, which the page reads from the transcript (it reads those in server mode too). In server mode the server also posts two kinds of message by itself, since you read the page and not the chat: the agent's final reply of a turn that changed nothing in the outline (the plugin's turn-end hook hands it over), and the output of a local command such as `/context` or `/model`, which Claude Code runs without a turn of the agent (read from the session's transcript, with the command's name). A red envelope under the queue column lists the last ten, with an unseen count, and a node with messages (its own or its descendants') gets its own grey envelope listing just those. Nothing goes into the markdown.
- **Permission prompts:** when the session's Claude Code asks for your permission to use a tool (outside auto mode: a shell command, say, while it accepts edits by itself), a server-mode outline's page shows the prompt as a pop-up, with the tool and its whole input. **Allow** and **Deny** answer it, and the session goes on as if you had answered in its terminal. The terminal shows its own dialog all the while, and whichever is answered first counts; answered there, the pop-up goes by itself. Closing the pop-up answers nothing: the prompt stays in the terminal, and a message in the inbox says so, as it does when nobody answers within nine minutes. The plugin's PermissionRequest hook carries it: it asks the server and waits for the answer.
- **Unread changes:** when the agent rewrites a node you have already seen (say, merging an answer into it), the page keeps showing what you read, with a blue diff icon left of its checkbox, so the outline doesn't jump. Hovering a parent node (or topic) shows a diff icon beside its reference button when anything under it changed; clicking it opens every change under that node at once, with the node staying where it is on the screen (changes out of view, or under a collapsed node, are taken in without animation). Clicking the diff icon, or the node's diff item at the top of the left pane, animates the bubble to the new text in up to four stages of half a second each: first the words about to go are marked, red for removed ones and orange for rewritten ones; then the removed words collapse together; then a cursor passes over the rewritten words, each collapsing while its replacement grows in beside it, in orange; then the cursor passes over the added words, which grow in one by one in green (pushing the rest of the text along). A stage with nothing to show is skipped, the colour of a word that came in fades out, and long texts go faster to fit. Nothing animates if the page is hidden or the system asks for reduced motion. What you have seen is kept per outline by the server; nodes that are new still appear right away.
- **Project:** the top bar shows the discussion's project (workspace or repo); its tooltip names the folder Claude runs in.
- **Archive:** the archive button on an outline's row in the pane, shown when you hover it, takes the row out of its project's group, at once. Nothing else changes: the outline stays where it is, its link opens, and its session and its agent work on it as before. The archived outlines are listed in the **Archived** group at the bottom of the pane, closed until you open it or search for one of them; the same button there, or **Unarchive** in the top bar of the outline's page, brings one back. An archived outline stays archived until you do. It is kept as a header line in the outline's file, `Archived: <day>`.
- **Delete:** the trash button on an outline's row in the pane, shown when you hover it, asks once, then ends the outline's session and moves the outline to `.trash/<project>/` in the outlines folder. Ending the session means ending the session terminal that **New** started for it; the transcript stays, so the session can be resumed. A tmux session you started yourself is left running, since it may hold more than the agent, and so is a session that runs outside tmux or one that another outline also names. This is how deleting differs from archiving, which leaves the session running.
- The top bar stays one row: what doesn't fit moves into a `⋯` menu.
- The terminal socket, the transcript stream, and the input box accept only this machine's own page (loopback address, `localhost`/`127.0.0.1` host, and for typing, our own origin).
- Every row has a 📋 button; click it to copy a reference (`Re: outline "…" › 2.1 …`) to paste into the chat and continue about that item.
- An outline is kept as markdown (easy to read and diff), and the server renders it. In server mode the agent changes it through the plugin's tools; in file mode the agent only writes markdown.

## Setup

Requires Node 20.19+ (or 22.12+). The Terminal tab, and typing from the Transcript tab, also need tmux (`brew install tmux`). `npm install` also builds the page (a React app in `web/`, see below) into `web/dist` with Vite; node-pty ships prebuilt binaries for macOS and Windows (other platforms compile it, and if that fails the Terminal tab is just not offered).

```bash
git clone https://github.com/hepiyellow/outline-only
cd outline-only
npm install
```

### Claude Code

```bash
npm run install-plugin               # adds this checkout as a plugin marketplace and installs the outline-only plugin
claude --plugin-dir ./plugin         # or: load the plugin for one session, without installing it
```

Then, in any conversation, type one of the plugin's two commands, optionally with a topic:

- **`/outline-only:outline`** starts an outline in server mode.
- **`/outline-only:outline-file`** starts an outline in file mode.

Either way the agent starts the server if it is not running, builds the outline from the conversation so far, and replies with a link. In server mode, with nothing discussed yet and no topic, it opens an empty outline without a name and waits for you to write. Both skills are user-invoked only (`disable-model-invocation: true` in [`plugin/skills/outline/SKILL.md`](plugin/skills/outline/SKILL.md) and [`plugin/skills/outline-file/SKILL.md`](plugin/skills/outline-file/SKILL.md)). Sessions started from the page's **New** button get the plugin from this checkout by themselves.

The plugin replaces the `/outline-only` skill that earlier versions linked into the skills folder: `npm run install-plugin` removes that link.

### Codex and other agents (untested)

**File mode** needs nothing but the instructions and a running server:

1. Put the instructions in [`plugin/skills/outline-file/SKILL.md`](plugin/skills/outline-file/SKILL.md) (everything below the frontmatter) into your agent's rules file: `AGENTS.md`, `.cursor/rules`, `GEMINI.md`, `CONVENTIONS.md`, and so on. The skill tells the agent to work out the plugin's folder from the skill file's path.
2. Start the server yourself with `npm start`, or with `node <checkout>/plugin/scripts/outline-ensure.js`, which starts it in the background and prints the outlines folder and the page's address.
3. Tell the agent to start an outline. It writes `<outlines folder>/<project>/<date>-<topic>.md` in the documented format and keeps editing the same file.

**Server mode.** The MCP process and the hook script use nothing agent-specific but two environment variables, so another agent needs three things:

1. **The MCP server**: `node <checkout>/plugin/scripts/outline-mcp.js` over stdio. For Codex, in `~/.codex/config.toml`:
   ```toml
   [mcp_servers.outline]
   command = "node"
   args = ["<checkout>/plugin/scripts/outline-mcp.js"]
   ```
2. **The instructions** in [`plugin/skills/outline/SKILL.md`](plugin/skills/outline/SKILL.md), as a skill or in the agent's rules file.
3. **The hooks**, where the agent has them: run `node <checkout>/plugin/scripts/outline-hook.js` on prompt submit, on session start after a resume or compaction, and at the end of a turn (Claude Code's `Stop`), where it prints `{"decision":"block","reason":…}` while ticks the agent was told of are not acknowledged. It reads the hook's JSON on stdin (`hook_event_name`, `session_id`, `cwd`, `source`) and prints what to add to the agent's context. Without hooks the agent still gets your approvals in every tool result.

The MCP process learns the session id from `CLAUDE_CODE_SESSION_ID` (or `CODEX_THREAD_ID`, unverified); without one, an outline is found again by the session's working folder.

### The tools

| Tool | What it does |
|---|---|
| `start` | Opens an outline for the session, or reattaches to the one it has. Returns the page link and the map. |
| `read` | Returns the whole outline, or one node and its descendants, as compact text. |
| `change` | Applies a list of operations together, or none of them: `add`, `update`, `move`, `remove`, `record`, `finish`, `message`, `queue`. |

The tools are for outlines in server mode: they pass over an outline in file mode, and refuse one that is named.

The outline's file is plain markdown (a `Title:` line, numbered headings as nodes with `@` tags for status, ordinary markdown as each node's text) in both modes. In server mode it is the server's storage, and agents do not read or write it. In file mode the skill has the exact rules for writing it.

### The Mac app

```bash
npm run app    # builds "Outline Only.app", installs it in /Applications, and installs the plugin
```

The Outline app, named **Outline Only** in the Dock, runs the server while it is open and shows the page in one window; closing the window quits it and stops the server. It listens on a port of its own (`appPort` in the settings file, picked on the first launch and kept), so it and `npm start` do not compete for one. On its first run, when there is no settings file yet, it asks where outlines are kept, proposing `~/outlines`. **Settings › Change Outlines Folder…** (in the app's own menu) picks another folder and offers to move the outlines there, with the trash and what the page remembers for each outline; it first names the outlines whose session is still running, since those sessions keep writing to the old folder. Once installed, it writes `linkBase` into the settings file, and links of the form `outline-only://open/<project>/<file>` open it on that outline, starting it if needed; only the installed app takes them, not `npm run app:dev`. It is built for this Mac only: signed ad hoc, not notarized, with no updater, so run `npm run app` again after a `git pull` (quit the app first). `npm run app -- --build-only` leaves the app in `dist/` without installing it, and `npm run icon` rebuilds its icon from `app/icon/icon.svg`.

### Viewing

Open the URL in a browser, or in an editor tab (in Cursor/VS Code: command palette → **Simple Browser: Show**, paste the URL).

### How the page works

The page is a React single-page app fed by JSON over server-sent events ([ADR 0001](docs/adr/0001-react-spa-fed-by-json-over-sse.md), [plan](docs/plans/viewer-spa.md)), built from `web/` into `web/dist` by `npm install`. It shows the outline list at `/`, an outline at `/<project>/<file>`, and a session just started at `/live?t=<tmux session>`; links to the old `/app/…` paths redirect there.

It reads `/api/outline/<project>/<file>`: the outline as JSON (header lines, nodes, queue and the Markdown tab; `web/src/types.ts` describes it), parsed by `outline.js`. `/api/outline/<project>/<file>/events` streams it, sent again whenever that file changes, so an agent's edit re-renders only what changed. That stream is the only one an outline's page holds: it also carries the viewer state, the outline list for the pane, and the linked session (its messages, its activity and, with `?transcript=1`, its transcript). A browser allows six connections to one server across all its windows, so a page with a stream per kind of data left none for requests once two windows were open.

What the page remembers for you (open and closed nodes, in file mode the approvals the agent has not recorded yet, what you have read, undo steps, seen messages, the input box's draft and the tab shown) is kept by the server, one file per outline in `.state/` of the outlines folder (`/api/state/<project>/<file>`), so the Outline app and a browser show the same thing. Marks the old page kept in the browser (what you had read, unsent ticks) were not carried over.

```bash
npm run build    # rebuilds web/dist after a change to web/ (npm install does this too)
npm run dev      # or `npm start -- --dev`: serves web/src through Vite instead, reloading edits in place
npm test         # type-checks web/ and runs the tests in test/
npm run app:dev  # the Outline app from this checkout: builds the page, then runs the server and one window in Electron
```

The browser tests run headless Chromium through Playwright: install it once with `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM` at a Chromium binary you already have.

## Configuration

Settings come from one settings file, `~/.config/outline-only/config.json`, then defaults:

```json
{ "dir": "~/Documents/outlines", "port": 4577, "resumeTemplate": "myagent --resume {session}" }
```

| Setting | Key | Default |
| ------- | --- | ------- |
| Outlines folder | `dir` | `~/outlines` |
| Server port | `port` | `4577` |
| Bind address | `host` (or the `OUTLINE_HOST` environment variable) | `127.0.0.1` |
| Template for the resume link or command the agent writes into each outline; `{session}` is replaced by the chat's session id | `resumeTemplate` | none |
| Port the Outline app listens on; the app picks and writes it | `appPort` | a free port |
| Start of the links to outlines, followed by `/<project>/<file>`; the installed app writes `outline-only://open` | `linkBase` | `http://localhost:<port>` |

The file is at a fixed path, and no environment variable overrides the outlines folder, the port or the resume template: the agent and the server both read the file, so they cannot disagree about where outlines go ([ADR 0002](docs/adr/0002-the-outline-app-owns-the-server.md)). `OUTLINE_DIR`, `OUTLINE_PORT`, `OUTLINE_CONFIG` and `OUTLINE_RESUME_TEMPLATE` are no longer read; put those values in the file.

Outlines are stored as `<dir>/<project>/<date>-<topic>.md`, one folder per project, outside your repos; an outline the server opens before it has a name is `<date>-<id>.md`, and keeps that file name when it is named. The page for a file is `http://localhost:<port>/<project>/<date>-<topic>`; `/` lists them all.

### Resuming a chat

How to reopen a chat depends on the agent, so the template is yours to configure. When an agent starts an outline, the chat's session id is filled in and the finished link or command is kept as the outline's `Resume:` line: by the server in server mode, by the agent in file mode. The page copies that line as written; the server never interprets it.

Examples (check your tool's docs for the exact form; these are the ones I know):

| Agent | `resumeTemplate` |
| ----- | ---------------- |
| Claude Code (terminal) | `claude --resume {session}` |
| Claude Code (editor extension) | `vscode://anthropic.claude-code/open?session={session}` (use `cursor://` in Cursor) |
| Codex CLI | `codex resume {session}` |

Web-only chat products (ChatGPT, Grok, …) can neither write files nor run the tools, so they cannot keep an outline; to track such a chat, paste its URL as the outline's `Resume:` line yourself.

If the template is empty, the agent writes a `Resume:` line only when it knows its own way to reopen a chat, and otherwise leaves it out.

To apply new settings, stop the server (`pkill -f outline-only/server.js`) and start it again with `npm start` (or the next `/outline-only:outline` or `/outline-only:outline-file` starts it).

## Notes

- Binds to localhost only. Raw HTML in the markdown is escaped. The server log is `~/.config/outline-only/server.log`: everything the server prints, crashes, commands that timed out and stalls of over a second, however the server was started.
- Topics and nodes with children become collapsible. The markdown stays readable in any viewer.
- The 📋 button only copies to the clipboard. Injecting text into an existing chat through an editor URI handler did not work when tried; the Terminal and Transcript tabs are the way to type into a discussion from the page.

## License

MIT
