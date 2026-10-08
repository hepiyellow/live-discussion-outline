# Live Discussion Outline

When an AI agent answers with several numbered points and you drill into one, then go back to another, the chat scrolls away from you. This tool mirrors the conversation into a markdown outline that the agent keeps up to date, and serves it as a collapsible web page that reloads itself on every change.

It is agent-agnostic. The server only watches a folder of markdown files; any agent that can write a file (Cursor, Codex, Gemini CLI, Aider, …) can feed it. A ready-made `/live-discussion-outline` skill is included for agents that support skills; for the others you give the agent the same instructions as a rule.

The solution has three parts:

1. **A skill you invoke.** `/live-discussion-outline` in a skills-capable agent. Other agents get the same instructions as a rules file.
2. **Instructions that make the agent write a markdown mirror of the discussion.** The agent keeps one file per conversation, with numbered points, status emoji and nested details, and edits it as the discussion moves.
3. **A small local server that renders that markdown as HTML.** It serves the outlines at `http://localhost:4577`, collapses and expands sections, and reloads the page when the file changes.

![A rendered outline: collapsed resolved topics, the 🔥 topic highlighted, and three levels of nesting](docs/screenshot.png)

The example in [`examples/demo/rate-limiting.md`](examples/demo/rate-limiting.md) is the markdown behind this screenshot.

Features:

- Every point and sub-point is numbered with its full path (`1`, `1.1`, `2.3.1`), in the chat and in the page, so "2.1" means the same thing in both places.
- Status emoji on each item: ❓ open, 🔥 being discussed now, ✅ resolved. Resolved items start collapsed; the 🔥 item is highlighted.
- The all-outlines table shows progress per outline: for checkbox-based outlines, a stacked bar (green = human `[x]`, blue = agent `[a]` / recommendations) plus counts; older emoji-only outlines still use ✅ / ❓ counts.
- **Resume later:** an outline can carry a `Resume:` line (a link or command that reopens the chat it came from). The page has a **Copy chat link** button and the all-outlines table has a **Chat** column with a 📋 button, so you can find a paused discussion and reopen its chat. See `resumeTemplate` below.
- A **Markdown** button at the top switches to the plain rendered markdown (a normal preview, nothing collapsible) and back; the choice is remembered per outline.
- A **Table / Bullets** button switches how bullets are shown: nested collapsible bullets, or one table per nesting level with columns number (last segment, full path on hover, 📋 copy), bold title and content. Table is the default; the choice is remembered per outline. Click anywhere on a parent row (outside its checkbox and buttons) to collapse or expand it; the circled number next to the side-chat button counts its direct children and fills in while the row is collapsed. Write bullets as `- ❓ 2.1 **Title.** content` for the table view.
- In the table view each bullet has a checkbox (`- [ ]` open, `- [a]` agent-approved, `- [x]` user-approved). Agent-approved shows a blue outlined tick. A parent with nested bullets shows the unique set of its descendants' icons (empty, blue agent tick, green pending human tick, filled human tick); if they all match, the parent shows that one icon. If any child is unchecked, the parent includes an empty checkbox. Ticking a parent also ticks every descendant. Ticking an open box, or clicking a blue agent tick, queues a human approval, draws a green outlined tick (pending, not filled), and copies the queued approval text to the clipboard. Queued approvals also show as tags in a bottom bar with a **Copy to clipboard** button, and are also included whenever you click a row's side-chat button (which copies that bullet's path). Copying clears the tags. The tick stays green-outlined until the agent writes `[x]` for that bullet; that file change is what fills the checkbox. A bullet tagged `@options` with nested option bullets is a single choice: it shows a "◉ Pick one" tag, its options render as radio buttons (choosing one clears the others and copies `Chosen in the outline: …`), and the option tagged `@recommended` shows a blue outlined dot and a 💡 Recommended tag. `@options` on a leaf shows a red "❓ Options" tag. `@Recommendation.` in the bullet text puts a 💡 Recommendation tag in the content cell, below the explanation and immediately before the recommendation, in that same cell, and shows the checkbox as a blue outlined tick. Bullets view shows the raw `[ ]` / `[a]` / `[x]` text.
- Page bar: expand all, collapse all, jump to 🔥, hide ✅. Which items you opened or closed, and your scroll position, survive reloads.
- Every row has a 📋 button; click it to copy a reference (`Re: outline "…" › 2.1 …`) to paste into the chat and continue about that item.
- The agent only writes markdown (cheap to edit, easy to diff). The server renders it.

## Setup

Requires Node 18+.

```bash
git clone https://github.com/hepiyellow/live-discussion-outline
cd live-discussion-outline
npm install
```

### Agents with skills support

```bash
npm run install-skill                # links the /live-discussion-outline skill into the default skills folder
npm run install-skill -- <folder>    # or into a skills folder of your choice
```

Then, in any conversation, type `/live-discussion-outline` (optionally `/live-discussion-outline some topic`). The agent starts the server if it is not running, writes the outline, and replies with a link. The skill is user-invoked only (`disable-model-invocation: true`); remove that line from `skill/SKILL.md` and re-run `npm run install-skill` if you want the agent to start outlines itself.

### Any other agent

1. Put the instructions in [`skill/SKILL.md`](skill/SKILL.md) (everything below the frontmatter) into your agent's rules file: `AGENTS.md`, `.cursor/rules`, `GEMINI.md`, `CONVENTIONS.md`, and so on. The skill tells the agent to resolve this checkout from the skill file's path.
2. Start the server yourself with `npm start` (or `node bin/ensure.js`, which starts it in the background and prints the outlines folder and URL).
3. Tell the agent to start an outline. It writes `<outlines folder>/<project>/<date>-<topic>.md` in the documented format and keeps editing the same file.

The format is plain markdown with numbered headings and bullets and a status emoji first on each item; see the skill for the exact rules.

### Viewing

Open the URL in a browser, or in an editor tab (in Cursor/VS Code: command palette → **Simple Browser: Show**, paste the URL).

## Configuration

Settings come from environment variables, then the config file, then defaults.

| Setting | Env var | Config file key | Default |
| ------- | ------- | --------------- | ------- |
| Folder for the markdown outlines | `OUTLINE_DIR` | `dir` | `~/live-discussion-outlines` |
| Server port | `OUTLINE_PORT` | `port` | `4577` |
| Bind address | `OUTLINE_HOST` | `host` | `127.0.0.1` |
| Template for the resume link or command the agent writes into each outline; `{session}` is replaced by the chat's session id | `OUTLINE_RESUME_TEMPLATE` | `resumeTemplate` | none |

The config file is `~/.config/live-discussion-outline/config.json` (override the path with `OUTLINE_CONFIG`):

```json
{ "dir": "~/Documents/outlines", "port": 4577, "resumeTemplate": "myagent --resume {session}" }
```

Outlines are stored as `<dir>/<project>/<date>-<topic>.md`, one folder per project, outside your repos. The page for a file is `http://localhost:<port>/<project>/<date>-<topic>`; `/` lists them all.

### Resuming a chat

How to reopen a chat depends on the agent, so the template is yours to configure. The `/live-discussion-outline` skill reads it from `bin/ensure.js` (`resume=` line), fills in the chat's session id, and writes the finished link or command as the outline's `Resume:` line. The page copies that line as written; the server never interprets it.

Examples (check your tool's docs for the exact form; these are the ones I know):

| Agent | `resumeTemplate` |
| ----- | ---------------- |
| Claude Code (terminal) | `claude --resume {session}` |
| Claude Code (editor extension) | `vscode://anthropic.claude-code/open?session={session}` (use `cursor://` in Cursor) |
| Codex CLI | `codex resume {session}` |

Web-only chat products (ChatGPT, Grok, …) cannot write files, so they cannot run the skill; to track such a chat, paste its URL as the outline's `Resume:` line yourself.

If the template is empty, the agent writes a `Resume:` line only when it knows its own way to reopen a chat, and otherwise leaves it out.

To apply new settings, stop the server (`pkill -f live-discussion-outline/server.js`) and start it again with `npm start` (or the next `/live-discussion-outline` starts it).

## Notes

- Binds to localhost only. Raw HTML in the markdown is escaped. The server log is `live-discussion-outline.log` in your temp folder.
- Headings and list items that own a sub-list become collapsible. The markdown stays readable in any viewer.
- The 📋 button only copies to the clipboard. Injecting text into an existing chat through an editor URI handler did not work when tried.

## License

MIT
