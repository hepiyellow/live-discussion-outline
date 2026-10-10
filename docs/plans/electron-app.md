# Plan — The Outline app

**Depends on:** [viewer-spa.md](viewer-spa.md) (done: the page is the React app) · **Decisions:** the "Electron Plan v1" outline (`~/.claude/outlines/live-discussion-outline/2026-10-09-heading-format-and-electron.md`, topic 1), summarized below · **Terms:** [CONTEXT.md](../../CONTEXT.md)

## Goal

A Mac application, the **Outline app**, that runs the server while it is open and shows the page in one window of its own. Agents keep writing outlines whether or not the app runs: the skill finds the outlines folder through one **settings file**, not through `bin/ensure.js`, which goes away with `/health`.

## How to work

- Read `README.md`, `CONTEXT.md` and ADR 0001 first. Use the glossary's terms in code, comments and commit messages.
- One step per branch and pull request, in order. Stop after each pull request and wait for review before starting the next step.
- Every step's **Checks** must pass in the pull request (`npm test`). Keep the app's logic in plain modules under `app/` that `node --test` can load without Electron; `app/main.js` only wires them to Electron.
- **Review** lists what the reviewer checks by hand on the Mac: Electron windows, the Finder, the Dock, tmux and live Claude Code sessions are not available to tests.
- `npm start` from the repo keeps working at every step; it is how the skill-only setup runs the server.

## Decisions this rests on

From the outline, by node number:

- **The app owns the server** (1.2, 1.3). It is the only thing that starts it, and quitting the app stops it. It is not a login item. The agent only writes files, so it never needs the server: `bin/ensure.js` and `/health` go.
- **One settings file** (1.3.2.2, 1.4): `~/.config/live-discussion-outline/config.json`, at a fixed path. The skill, the server and the app all read it. No environment variable overrides the folder, the port or the file's path: an app opened from the Finder does not see the shell profile's variables while the agent does, so they would disagree.
- **One default folder** (1.3.2.2.1): without the file, or without its `dir`, the outlines folder is `~/live-discussion-outlines`, for the skill, the server and the app alike.
- **The app has its own window** (1.6.2), **one window** (1.10.4), laid out like the Claude desktop app: outlines pane on the left, the outline in the main area. The window is a page the server serves (1.10.4.4); the app adds the window, the link scheme and the menus, and a browser shows the same page.
- **Links open the app** (1.7.2): agents print links in the app's own scheme when the app wrote the settings file, and `http://localhost:…` links otherwise.
- **Changing the folder offers to move the outlines** (1.8.1), naming those whose session still runs.
- **Built from the repo** (1.9.1) by `npm run app`, for this Mac only: ad-hoc signature, no notarization, no updater (1.12.3).
- **The server runs in a utility process** (1.11.2), so its blocking `ps` and `tmux` calls never freeze the window, and a crash does not take the app down.
- **PATH from the login shell** (1.12.1), so the server finds Homebrew's `tmux` and the `claude` command.
- **First run asks for the folder** (1.12.2), proposing the default.
- **Closing the window quits the app** (1.12.4). The Dock entry is named **Outline Only** and has the app's own icon (`app/icon/`, rebuilt by `npm run icon`), with no badge or menu (1.12.4.1; the name and icon were decided later, on 2026-10-10).
- **A free port, kept** (1.12.5.2, 1.12.5.2.1): the app picks a free port on its first launch, saves it in the settings file, and reuses it; only if it is taken does it pick another. Per-viewer state is on the server since ADR 0001, so a new port loses only the page's `localStorage` conveniences (pane width and visibility), but keeping one costs nothing.
- **The input box** is fixed at the bottom of the window, disabled in the Terminal tab (1.10.4.3). For an outline whose session is not running, its button reads "Resume and send" (1.10.4.3.1).

## The settings file

```json
{
  "dir": "~/.claude/outlines",
  "resumeTemplate": "cursor://anthropic.claude-code/open?session={session}",
  "port": 4577,
  "appPort": 51234,
  "linkBase": "outline://open"
}
```

- `dir`, `resumeTemplate`, `port`, `workspaceDirs`, `claudeCommand`: as today. `port` is what `npm start` listens on.
- `appPort` (new): the port the app picked and keeps. Separate from `port`, so the app and `npm start` from the repo never fight over one port.
- `linkBase` (new): the start of every link the skill prints, followed by `/<project>/<file>`. The app writes `outline://open`; without the key it is `http://localhost:<port>`. The project goes in the path, not the host, because URL parsers lowercase hosts and project names have capitals (`ma3-pro-plugins-mainV2`).
- Whoever writes the file keeps the keys it does not own.

## Steps

### 1. One settings file

- `config.js` reads only `~/.config/live-discussion-outline/config.json` (through `os.homedir()`), and no longer reads `OUTLINE_DIR`, `OUTLINE_CONFIG` or `OUTLINE_PORT`. It returns `appPort` and `linkBase` too.
- A `writeSettings(patch)` beside it merges keys into the file and creates its folder; the app uses it from step 3 on.
- `test/helpers.js` stops passing those variables: it writes a settings file into the temporary `HOME` it already sets (`dir`, a free `port`).
- `bin/ensure.js` keeps working on the new `config.js` until step 7.

**Checks:** tests for `loadConfig` (file missing, `dir` missing, `~` expanded) and `writeSettings` (keeps unknown keys); the whole suite passes on the new helper.
**Review:** `npm start` still serves your outlines from your own settings file.

### 2. The server takes its port from its parent

- `server.js` accepts `--port <n>`: it listens there, or on a free port if that one is taken. Without the flag it listens on the settings file's `port`, as today.
- Once listening, it reports `{ port }` to its parent: `process.parentPort.postMessage` in a utility process, a `port=<n>` line on stdout otherwise.
- Everything that uses `PORT` uses the port actually listened on: `fromLocalPage` (its Host and Origin check) and `attachTerminals`.

**Checks:** started with `--port` on a taken port, the server reports another port and answers there; the Origin check accepts that port and refuses the old one.

### 3. The app runs the server in its window

- `electron` as a dev dependency; `package.json` `main` is `app/main.js`; `npm run app:dev` builds the page and starts Electron on the repo.
- At launch, `app/path.js` reads PATH from the login shell (`$SHELL -ilc`, as `start.js` does to find `claude`, with a timeout), falling back to the current PATH plus `/opt/homebrew/bin:/usr/local/bin`.
- `utilityProcess.fork('server.js', ['--port', appPort])` with that PATH; when no `appPort` is saved, `--port 0`. The reported port is saved as `appPort` when it differs.
- One `BrowserWindow` on `http://127.0.0.1:<port>/`, opened once the server reports its port. Closing it quits the app; quitting ends the server process.
- If the server process dies, the app restarts it once on the same port, and shows an error with the end of `~/.config/live-discussion-outline/server.log` if it dies again.
- The default menus, plus **Open in Browser** (the current page's URL in the default browser).
- `app.requestSingleInstanceLock()`: a second launch focuses the first window.
- `node-pty` 1.1 is built on Node-API (`node-addon-api`) and ships prebuilt binaries, which Electron should load as they are. Check that first; add `@electron/rebuild` only if they do not load. A rebuild in the repo's `node_modules` would break `npm start` and the tests under plain Node, so it belongs to step 4's packaged copy.
- Electron's utility process must run `server.js` as an ES module with top-level `await`; check this before anything else, since the server relies on it.

**Checks:** `app/path.js` parses a login shell's output and falls back on a timeout (unit tests with a fake shell).
**Review:** `npm run app:dev` shows your outlines; the Terminal tab attaches to a running session; closing the window leaves no server process (`lsof -i :<port>`); `kill` on the server process brings it back.

### 4. npm run app

- `@electron/packager` builds `Outline Only.app` from the repo, with `app/icon/icon.icns` as its icon: page built first (`npm run build`), dev dependencies left out, no asar archive, so `node-pty`'s binary and `spawn-helper`, `web/dist` and the server's files load as they do from the repo.
- `spawn-helper` gets its execute bit before packaging (the fix in `terminal.js` would otherwise modify the signed bundle).
- Signed ad hoc (`codesign --force --deep --sign -`), copied to `/Applications` (replacing an older copy), then `node bin/install-skill.js`. The skill stays a symlink into the repo, so a `git pull` updates it before any rebuild.

**Review:** open the app from the Finder (not a terminal, so the PATH from step 3 is what finds `tmux`); the Terminal tab works; "New session" starts `claude`.

### 5. First run and the folder setting

- `app/settings.js`: without a settings file, the app asks before starting the server: use `~/live-discussion-outlines`, or choose another folder. It writes `dir`.
- **Settings › Change Outlines Folder…** chooses a folder, writes `dir`, and offers to move the outlines: "Move N outlines to the new folder?" Before asking, it names the outlines whose session is still running (their `Session:` id among `runningSessions()` from `start.js`), since those sessions will keep writing at the old path.
- Moving takes the whole folder's content: the project folders, and the `.state` (per-viewer state) and `.trash` folders, so read marks and unsent approvals move with their outlines.
- The app restarts the server on the same port to watch the new folder.

**Checks:** the move plan (what moves, what is skipped because the target exists, which outlines have running sessions) as a pure function, tested on a fixture folder.
**Review:** first launch with no settings file; change the folder with a session running, and see it named.

### 6. outline:// links

- First, by hand: print `outline://open/demo/sample` in the Claude Code terminal (in iTerm and Terminal), in the Claude desktop app and in Cursor's chat, and check each makes it clickable. If one does not, stop and decide (see **Open**) before building.
- The packaged app registers the scheme (`protocols` in the packager options, so it lands in `Info.plist`); `npm run app:dev` registers it with `app.setAsDefaultProtocolClient`.
- `open-url` is handled from `will-finish-launching` on, so a link that starts the app is not lost: `outline://open/<project>/<file>` shows `/<project>/<file>` in the window, starting the app if needed.
- The app writes `linkBase: "outline://open"` into the settings file.

**Checks:** `app/links.js` maps link to page path (capitals and dashes in the project kept, anything outside `open/<project>/<file>` refused).
**Review:** with the app closed, clicking an `outline://` link in each of those places opens it on that outline.

### 7. The skill reads the settings file

- `skill/SKILL.md` Start step: read `~/.config/live-discussion-outline/config.json` for `dir` (default `~/live-discussion-outlines`), `linkBase` (default `http://localhost:<port or 4577>`) and `resumeTemplate`; read the session id from `$CLAUDE_CODE_SESSION_ID`, the tmux session with `tmux display-message -p '#S'` when `$TMUX` is set, and the project from `$OUTLINE_PROJECT`. The link the skill replies with is `<linkBase>/<project>/<file>`.
- The skill rewrites the `Terminal:` line when its tmux session changed (a resumed session runs in a new one, step 8).
- Delete `bin/ensure.js`, the `/health` route and `npm run ensure`; update the README's setup, the comment in `terminal.js` about `ensure.js`, and the hint in `web/src/components/TranscriptTab.tsx` that names it.
- Last on purpose: until steps 3 to 6, `ensure.js` is what starts the server for agents.

**Checks:** nothing imports or mentions `ensure.js`; `/health` is a 404.
**Review:** a new Claude Code session, with the app closed, writes its outline into your folder and replies with an `outline://` link; with no settings file, into `~/live-discussion-outlines` with an `http://` link.

### 8. The input box at the bottom

- `OutlinePage.tsx` renders the input box on every tab when the outline is linked; in the Terminal tab it is disabled, with a note that the terminal takes typing.
- An outline with a `Session:` line whose session is not running gets the box with a "Resume and send" button. Sending resumes the session (`startSession({ kind: 'resume', id })`, which starts it in a new tmux session with `/live-discussion-outline` as its first prompt), holds the message until that first turn ends, then types it in. An outline with no `Session:` line keeps the box disabled.
- The outlines pane's queue row sits above the input box (the "Outline UX Rework" outline); check its state before changing the bottom row.

**Checks:** page tests: the box is disabled in the Terminal tab; a fixture outline with a stopped session shows "Resume and send", and sending calls the start API with `kind: 'resume'`.
**Review:** resume a stopped session from its outline and see the message arrive after the outline is updated.

## Open

- **ADR 0002.** "The Outline app owns the server; agents find the outlines folder through one settings file" meets the three criteria (hard to reverse once skills in the wild read the file, surprising without context, a real trade-off against `ensure.js` starting the server and against the app writing into the skill). Recommended: write it with step 1.
- **The scheme's name.** `outline://` is short but generic; another app may claim it (an Outline wiki client, for one), and macOS then picks one of them. Recommended: a distinctive name, `live-outline://`, decided before step 6.
- **The remaining overrides.** `OUTLINE_RESUME_TEMPLATE` makes the server and the skill disagree like the others (the skill reads the file); recommended: drop it in step 1. `OUTLINE_HOST`, `OUTLINE_WORKSPACE_DIRS` and `OUTLINE_CLAUDE` only affect the server; they can stay.
- **A link that fails to be clickable** in step 6's check: print both links in that agent, or only `http://` there.

## Done when

The app, opened from the Finder, shows every outline in its one window; an agent with the app closed writes its outline into the folder from the settings file and replies with a link that opens the app on it; `bin/ensure.js` and `/health` are gone; and `npm start` from the repo still serves the same page for the skill-only setup.
