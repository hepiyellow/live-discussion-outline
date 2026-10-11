# Plan — Two modes: an outline is kept by its agent as a file, or by the server

**Status:** built on the `two-modes` branch, steps 1 to 5; "Review by hand" is still to do. · **Depends on:** the `outline-over-mcp` branch ([ADR 0003](../adr/0003-the-server-owns-the-outline.md) as built) · **Decisions:** [ADR 0001](../adr/0001-react-spa-fed-by-json-over-sse.md), [ADR 0003](../adr/0003-the-server-owns-the-outline.md) · **Terms:** [CONTEXT.md](../../CONTEXT.md)

## Goal

Make both ways of keeping an outline work in one codebase, chosen per outline session when it starts:

- **File mode:** the agent writes the outline's markdown file itself, following a skill. This is what `main` does.
- **Server mode:** the server writes the file, and the agent sends operations through the plugin's MCP tools. This is what `outline-over-mcp` does.

The two modes are a transition, not a permanent feature. They let server mode be tried on real sessions with file mode as the fallback. One of them is retired later, so the work below keeps the seam between them narrow and adds nothing new to file mode.

## Where things stand

- **`main`** (at `f7e4863`) has file mode only.
  - The agent follows `skill/SKILL.md`, started by `bin/ensure.js`, and installed by `bin/install-skill.js`.
  - The page keeps the user's ticks as viewer state (`overrides`, `sent`, `backTo`) and types lines such as `Approved in the outline: …` into the session terminal. A tick is pending until the agent records it in the file.
- **`outline-over-mcp`** (four commits over the same `f7e4863`) has server mode only.
  - It added `model.js` (the outline as a tree, its operations, its writer), `agent.js` (`start`, `read`, `change`, the hooks' `pending` and `reload`, the page's `act`, and a ledger per outline under `.ledger/`), the `plugin/` folder (skill, MCP process, hooks), `bin/install-plugin.js` and `test/mcp.test.js`.
  - It removed file mode: `skill/SKILL.md`, `bin/ensure.js`, `bin/install-skill.js`, the three viewer-state sections, the pending status, `web/src/components/StatusBar.tsx`, and the page code that composed the approval lines.

`git diff main...outline-over-mcp` is the full list of what differs. A file as `main` has it is `git show main:<path>`.

## Decisions

1. **The mode belongs to the outline and is fixed at start.** It is a header line in the outline's file, `Mode: server`. A file without the line is in file mode, so every existing outline and every file an agent writes with the old skill needs no change.
2. **Both modes store the same markdown.** Everything that reads an outline (the parser in `outline.js`, the page, the node history, unread changes) stays one code path.
3. **An outline has one writer.** In server mode it is the server. In file mode it is the agent, and the server never writes the file except to rename it, as on `main`. The server must never parse and rewrite a file-mode outline through `model.js`: `serializeOutline` would reformat a file its agent is editing.
4. **File mode is `main`'s behaviour, restored unchanged.** The page chooses between two implementations of the user's ticks by the outline's mode. An earlier idea was to move that choice into the server, with the page always posting the action. Reading the branch showed that would mean rewriting file mode's batching, pending and copy-to-clipboard logic on the server, which puts new bugs into the mode that is meant to be the safe fallback.
5. **Both skills ship in the plugin**, so there is one thing to install: `/outline-only:outline` (server mode, as now) and `/outline-only:outline-file` (file mode).
6. **Nothing here needs a new ADR.** The two modes are cheap to undo. ADR 0003 gets a note instead (step 5).

## How to work

- Branch from `outline-over-mcp`. Read `README.md`, `CONTEXT.md`, ADR 0003 and [the MCP plan](outline-over-mcp.md) first. Use the glossary's terms in code, comments and commit messages: **file mode** and **server mode**, never "MCP mode" or "legacy".
- One commit per step, in order. `npm test` passes after each (type check, server tests, and the browser tests against the fixtures).
- Restore from `main` instead of rewriting: file mode must behave exactly as it does there.
- Do not add features to file mode, and do not change server mode's behaviour.

## Steps

### 1. The mode header, and the server keeps to it

- **Read it.** `extractHeaders` in `outline.js` takes a `Mode:` line with the other header lines; any value but `server` means file mode. `outlinePayload` carries `mode: 'file' | 'server'` to the page (`web/src/types.ts`).
- **Write it.** `model.js` keeps `headers.mode` when it parses and writes it when it serializes. `start` in `agent.js` creates outlines with `mode: 'server'`.
- **The agent's API is for server-mode outlines only.** In `agent.js`, `locate` skips file-mode outlines in both of its searches (by session id and by working folder). A call that names a file-mode outline is refused with a text that says the outline is kept by its agent as a file.
  - This also makes `pending` and `reload` say nothing in a file-mode session. Without it, `reload` would tell a file-mode agent to keep the outline "with one change call".
- **The page's `act` is for server-mode outlines only.** `actApi` in `server.js` answers 400 for a file-mode outline.
- **Rename.** `renameOutline` keeps writing the `Title:` line in both modes, and calls `agent.userEvent` only in server mode.
- **Outlines the branch already made** have a ledger and no `Mode:` line. When the server starts, give each of them the line.

**Checks:** `test/outline.test.js` reads the header both ways. `test/mcp.test.js`: `start` writes `Mode: server`; the tools refuse a named file-mode outline; a server-mode `start` in a folder that holds a file-mode outline opens a new one; `pending` and `reload` return nothing for a session whose outline is in file mode. `test/api.test.js`: `act` on a file-mode outline is refused and leaves the file untouched.

### 2. The page: file mode's ticks beside server mode's

What `main` has is a superset of what the branch has, because server mode never leaves anything in `overrides`. So most of this step is restoring `main`'s version:

- **Viewer state:** the `overrides`, `sent` and `backTo` sections in `state.js`, `web/src/lib/viewerState.ts` and `web/src/types.ts`.
- **The pending status:** `web/src/lib/status.ts`, the comment in `StatusBox.tsx`, `handled` in `queue.tsx`, the styles the branch took out of `web/src/outline.css`, and `new Statuses(outline.nodes, viewer.overrides)` in `OutlinePage.tsx` and `OutlineTab.tsx`.
- **The status bar:** `web/src/components/StatusBar.tsx` and its use in `OutlinePage.tsx`, shown in file mode only.
- **Undo steps:** `main` keeps `{ num, had, was, file }` and the branch `{ num, file }`. Use one type with `had` and `was` optional.

Then the one real fork:

- **Two implementations of the ticks,** each in its own files: `main`'s `useApprovals.ts` and `lib/approvals.ts` for file mode, the branch's for server mode. What both use (`referenceTo`, `removalOf`, `pathTo`) lives in one place.
- **Chosen by `outline.mode`.** The mode does not change while an outline is shown; key the component on it so the choice of hook is the same on every render.

**Checks:** `main`'s `test/approvals-page.test.js` comes back as the file-mode test, and the branch's stays as the server-mode test with a fixture that has `Mode: server`. `test/state.test.js` covers the restored sections. `test/queue-page.test.js` and `test/outline-page.test.js` pass in both modes.

### 3. The file-mode skill in the plugin

- **`plugin/skills/outline-file/SKILL.md`** is `main`'s `skill/SKILL.md` with two changes: its name, and its Start step. Everything else stays word for word, including the rule from `f7e4863` that removing a node renumbers the ones after it. Add one line saying this mode does not use the outline tools.
- **`plugin/scripts/outline-ensure.js`** replaces `bin/ensure.js`. It starts the server when none is running and prints the same six lines (`dir=`, `url=`, `resume=`, `terminal=`, `session=`, `project=`), taking each value the way `outline-mcp.js` and `lib.js` already do. It uses Node's own modules only (ADR 0003).
- **How the skill finds the script.** `main`'s skill tells the agent where its own file is and to resolve the path from there. Keep that pattern, relative to the skill's file. Check whether Claude Code offers a variable for a skill's own folder before relying on one.
- **A guard for server mode.** Add a `PreToolUse` hook for the file-writing tools that refuses a write to a file in the outlines folder whose header says `Mode: server`, with a reason that names the outline tools. Check the refusal's format against Claude Code's hooks reference. Writes through the shell are not covered.
- **`bin/install-plugin.js`** keeps removing the old symlinked skill: file mode now comes from the plugin.

**Checks:** a test runs `outline-ensure.js` against the test server and reads its six lines. A test feeds the guard hook a write to a server-mode outline (refused), to a file-mode outline (allowed) and to a file elsewhere (allowed).

### 4. Choosing the mode when a session starts

- **The dialog** (`web/src/components/NewSession.tsx`) offers the two modes for a session started from a workspace or a folder, with server mode preselected.
- **A resumed session** keeps the mode of the outline that links to it, when there is one; otherwise the choice applies.
- **`/api/start`** takes `mode` and refuses any other value. In `start.js`:
  - the first message is `/outline-only:outline` or `/outline-only:outline-file`, with the topic;
  - `--plugin-dir` is passed in both modes;
  - `--allowedTools mcp__plugin_outline-only_outline` is passed in server mode only.
- **In a chat the page did not start,** the user chooses by the command they type.

**Checks:** `test/starting-page.test.js` and `test/session-page.test.js` cover both choices and the resumed case.

### 5. Documents

- **`README.md`:** the two modes, how to choose one, and both commands.
- **`CONTEXT.md`:** **Mode** is already there. Bring these entries in line with two modes: **Outline**, **Status** (pending exists in file mode), **Outlines folder**, **Settings file**, **Message** and **Viewer state**.
- **ADR 0003:** a note at the top that file mode is kept beside server mode for a transition, the way ADR 0002 got its note. Its consequence "an agent without the plugin can no longer feed the page by writing a file" no longer holds.
- **[outline-over-mcp.md](outline-over-mcp.md):** its status line.

## What must stay one code path

- Reading and showing an outline, the node history, and unread changes.
- The inbox: `useOutline.ts` already merges the transcript's `@message` paragraphs with the ledger's messages.
- The trash button: in both modes it sends `Removed from the outline: …` through the input box, and the agent removes the node its own way.
- Renaming, the tabs, the outline list and the Outline app.

## Out of scope

- Changing an existing outline's mode from the page.
- Codex packaging, the Claude Code channel, and cloud agents.
- New page actions in file mode.

## Review by hand

These need a live session, which the tests cannot give:

1. **File mode from the page:** the outline appears; a tick fades as pending, then stays once the agent records it; Run reaches the agent.
2. **Server mode from the page:** a tick is recorded at once; the agent hears of it with the next prompt; Run reaches the agent.
3. **Both at once in the same project folder:** neither session attaches to the other's outline.
4. **The guard:** in a server-mode session, ask the agent to edit the outline's file directly. The hook refuses.
5. **In a plain chat:** `/outline-only:outline` and `/outline-only:outline-file` each start their mode.
6. **After compaction** in a file-mode session: nothing about outline tools is added to the context.

## Retiring a mode later

- **Retiring file mode:** delete `plugin/skills/outline-file/`, `plugin/scripts/outline-ensure.js`, the guard hook, the file-mode ticks files, `StatusBar.tsx`, the three viewer-state sections, the pending status, the choice in the dialog and the mode checks in `agent.js` and `server.js`. Keep reading files without a `Mode:` line as server mode from then on, after giving every remaining outline the line.
- **Retiring server mode:** delete `model.js`, `agent.js`, the plugin's MCP process and hooks, the server-mode ticks files and `test/mcp.test.js`, and move the file-mode skill back to being the plugin's only skill.
