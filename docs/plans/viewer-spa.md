# Plan — The outline page becomes a single-page app

**Depends on:** nothing · **Decisions:** [ADR 0001](../adr/0001-react-spa-fed-by-json-over-sse.md) · **Terms:** [CONTEXT.md](../../CONTEXT.md)

## Goal

Replace the page that `render.js` builds as one HTML string (about 340 lines of CSS and 630 lines of inline script), and that reloads on every outline edit, with a React single-page app fed by JSON over SSE. Port it feature by feature: until the cutover, the new app is served at `/app/<project>/<file>` beside the old page at `/<project>/<file>`, so the two can be compared side by side.

## How to work

- Read `README.md`, `CONTEXT.md` and ADR 0001 first. Use the glossary's terms in code, comments and commit messages.
- One step per branch and pull request, in order. Stop after each pull request and wait for review before starting the next step.
- Every step's **Checks** must pass in the pull request: `npm test` (server tests with `node --test`, and from step 2 on, browser tests against the fixtures).
- **Review** lists what the reviewer checks by hand with a live session, which a cloud machine cannot do: there is no tmux, no Claude Code transcripts and no outlines folder there. Do not fake them; use the fixtures.
- Keep the old page working until step 9. Both pages read the same parser from step 1 on.

## Decisions this rests on

- ADR 0001:
  - React + Vite + TypeScript, styled with shadcn/ui on Tailwind v4, built on install.
  - Structure travels as JSON; prose arrives as server-rendered HTML; the terminal stays a byte stream.
  - Per-viewer state lives on the server.
  - Port feature by feature.
  - The Outline app (Electron) shows the same page.
- Parts of the page that change the DOM directly (the diff animation, sticky header stacking, xterm) work through a ref on an element whose children React does not manage. A node's body is server HTML set with `dangerouslySetInnerHTML`.
- Per-viewer state is stored per outline. There is one user, so it has no user key. Two windows on one outline share it, and the last update to a node wins.
- A cloud setup (agent and server remote, browser only a view) is out of scope. Keeping state on the server is the one step toward it.

## Fixtures

Added in step 1, under `test/fixtures/`, and used by every later step:

- `outlines/demo/sample.md` is an outline with every feature:
  - all header lines
  - nested nodes six levels deep
  - each status and tag (`@options` with a picked and a recommended option, `@action` and `@ran`)
  - all three closing lines
  - a queue
- `outlines/demo/sample-edited.md` is the same outline after an agent's edit: one node rewritten, one added, one approved. It drives the unread-diff and live-update tests.
- `transcripts/sample.jsonl` is a short recorded Claude Code transcript with assistant and user text, a tool call with its result, an error result, a title, and an `@message` paragraph.

Each test copies the fixtures into a temporary folder and starts the server with these settings:
- `OUTLINE_DIR` pointing at that copy, so the test can edit an outline the way the agent would.
- `OUTLINE_PORT` set to a free port.
- `HOME` set to the temporary folder, with the transcript placed at `.claude/projects/<any>/<session id>.jsonl`. `transcript.js` finds transcripts under `~/.claude/projects`.

## Steps

### 0. Scaffold

- `web/` holds the client: Vite, React, TypeScript, Tailwind v4, `shadcn` initialized with a neutral theme.
- `package.json`: `prepare` runs `vite build`; Vite, React and Tailwind are dev dependencies; `npm test` runs the tests.
- `server.js` serves `web/dist` under `/app/` and falls back to `index.html` for client routes. With `--dev` it mounts Vite in middleware mode instead (hot reload).
- README: setup now builds on install.

**Checks:** a fresh `npm install` builds `web/dist`; a test starts the server and gets the app shell at `/app/` and at `/app/demo/sample`.
**Review:** `npm start -- --dev` hot-reloads an edit to `web/src`.

### 1. Outline JSON and its stream

- Move the parser out of `render.js` into `outline.js`: headers, the node tree (number, level, tags, status, title, body `html`, closing lines), the queue, and the Markdown tab's `html`. The old page uses it too, so there is one parser.
- `GET /api/outline/<project>/<file>` returns that payload.
- `GET /api/outline/<project>/<file>/events` (SSE) pushes the payload again when that file changes. Today `/events` tells every open page about any change anywhere in the outlines folder; this stream is per outline.
- The payload's types are written once in `web/src/types.ts`; the server stays JavaScript.
- Add the fixtures above.

**Checks:** parser tests on `sample.md` (numbering, tags, statuses, closing lines, queue, headers); the endpoint returns it; replacing it with `sample-edited.md` pushes a new payload on the stream; the old page still renders `sample.md`.
**Review:** the JSON of a real outline looks right.

### 2. Read-only outline

- App shell: top bar (title, project, model, resume copy), tabs, left pane.
- Outline tab:
  - topics and nodes as components keyed by number, with status icons and roll-up
  - tags (options, recommended, action, ran) and closing-line tags
  - collapse, with expand all and collapse all
  - the orange path to the current node, and the jump to it
- Sticky stacked headers through a ref.
- Markdown tab from the payload's `html`.
- Edits re-render in place: no reload, and scroll position and open nodes stay.
- Browser tests (Playwright, headless Chromium, since the Outline app is Chromium) start the server on the fixtures.

**Checks:** browser tests on `sample.md`: every node and tag renders, collapse works, and swapping in `sample-edited.md` updates the page without a reload and keeps a collapsed node collapsed.
**Review:** an outline looks and reads at `/app/…` as on the old page.

### 3. Viewer state on the server

- `state.js` keeps one JSON file per outline: unsent approval changes, what was sent, read versions per node, open nodes, undo steps, run requests.
- `GET` and `PATCH /api/state/<project>/<file>`. A PATCH changes single nodes, and the last write wins per node. Changes are pushed on the outline's stream so two windows agree.
- The files live under `.state/` in the outlines folder, and the folder watcher ignores `.state/` and `.trash/`; otherwise each state write would announce itself as an outline change.

**Checks:** server tests for the store, the PATCH merge and the watcher ignoring `.state/`; a browser test: collapse a node, reload, and it stays collapsed; a second page on the same outline sees the change.

### 4. Approvals, options, actions, queue, undo

- Ticking, picking an option, and pressing play send `Approved in the outline: …`, `Chosen in the outline: …` and `Run in the outline: …` through `/send` when a terminal is linked, or offer to copy them when none is, as today.
- Pending ticks show until the agent records them; completed parents collapse; undo (button and ⌘Z) sends `Reopened in the outline: …` and `Back to claim in the outline: …`.
- The queue in the left pane, hiding items once handled.
- Copy or insert a reference to a node.
- `/send` sits behind one function the tests replace, so no tmux is needed.

**Checks:** browser tests on `sample.md` without a terminal: the exact text of each message for tick, pick, run and undo (including undo over mixed children), pending ticks clearing when the file records them, queue items hiding.
**Review:** the same round trip with a live session.

### 5. Unread changes

- Read versions in the viewer state drive the blue diff icon and the left pane's list of changed nodes.
- The cursor diff animation is ported onto the node body through a ref, with the same timing and the same reduced-motion and hidden-page rules.

**Checks:** browser test: open `sample.md`, swap in `sample-edited.md`; the rewritten node keeps its old text with a diff icon, the new node shows at once, and clicking the icon ends with the new text (run with reduced motion so it is instant).
**Review:** the animation looks as on the old page.

### 6. Inbox, input box, spinner

- Inbox from `/messages`, for the outline and per node, with unseen counts (seen marks in the viewer state).
- Input box with reference chips, a draft kept per outline, and the slash-command list (shadcn command menu over `/api/commands`).
- Working spinner from `/activity`.

**Checks:** server tests reading `transcripts/sample.jsonl` (messages, activity); browser tests: the `@message` shows in the inbox and on its node; a chip and text compose the right message to the replaced `/send`.
**Review:** sending reaches a live session; the spinner follows its turns.

### 7. Transcript and Terminal tabs

- `transcript.js` sends typed entries (`assistant-text`, `user-text`, `tool-use`, `tool-result`, `title`) on the outline's stream, as `transcript` events, once the page asks for them (`?transcript=1`); the old `/transcript` stays until step 9. The page holds that one stream only (a browser allows six connections to one server across its windows), so the session's messages and activity travel on it too.
- One component per entry type; tool calls and results collapse.
- Terminal tab: xterm mounted through a ref on the existing `/term` socket, loaded only when the tab opens.
- Outline changes no longer wait while these tabs are open, since nothing reloads.

**Checks:** server tests for the typed entries from `sample.jsonl`; browser test of the Transcript tab on it; the Terminal tab shows its "not attached" notice when no tmux session exists.
**Review:** both tabs with a live session.

### 8. Outline list and starting a session

- The outline list: progress, delete to trash, rename.
- The new-session dialog (workspace, folder or past session) and the `/live` page that shows the terminal until the outline exists.

**Checks:** browser tests on the fixtures folder: list, rename, delete to `.trash/`.
**Review:** starting a session from the dialog.

### 9. Cutover

- The app takes over `/` and `/<project>/<file>`, so links that agents print keep working; `/app/…` redirects there.
- Remove `renderPage` with its CSS and script, the page script in `start-dialog.js`, `/events`, the old `/transcript`, and the `/vendor` routes that the bundle replaces.
- README and `CONTEXT.md` updated; `render.js` is deleted or reduced to markdown helpers.
- Old browser marks (read versions, unsent ticks in `localStorage`) are not carried over unless decided otherwise before this step.

**Checks:** all tests pass against `/<project>/<file>`; no route serves the old page; nothing imports the removed code.
**Review:** daily use for a day before merging.

## Open

- **Old browser marks at cutover.** Recommended: start fresh, losing "already read" marks and unsent ticks once. The alternative is a one-time import of the old `localStorage` keys on first load. Decide before step 9.

## Done when

Every outline opens in the React app at its usual link, agent edits show without a reload, and the per-viewer state is the same in the Outline app and in a browser.
