# Live Discussion Outline

When an AI agent answers with several numbered points and you drill into one, then go back to another, the chat scrolls away from you. This tool mirrors the conversation into a markdown outline that the agent keeps up to date, and serves it as a collapsible web page that reloads itself on every change.

It is agent-agnostic. The server only watches a folder of markdown files; any agent that can write a file (Cursor, Codex, Gemini CLI, Aider, …) can feed it. A ready-made `/outline` skill is included for agents that support skills; for the others you give the agent the same instructions as a rule.

- Every point and sub-point is numbered with its full path (`1`, `1.1`, `2.3.1`), in the chat and in the page, so "2.1" means the same thing in both places.
- Status emoji on each item: ❓ open, 🔥 being discussed now, ✅ resolved. Resolved items start collapsed; the 🔥 item is highlighted.
- A **Markdown** button at the top switches to the plain rendered markdown (a normal preview, nothing collapsible) and back; the choice is remembered per outline.
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
npm run install-skill                # installs the /outline skill into the default skills folder
npm run install-skill -- <folder>    # or into a skills folder of your choice
```

Then, in any conversation, type `/outline` (optionally `/outline some topic`). The agent starts the server if it is not running, writes the outline, and replies with a link. The skill is user-invoked only (`disable-model-invocation: true`); remove that line from `skill/SKILL.md` and re-run `npm run install-skill` if you want the agent to start outlines itself.

### Any other agent

1. Put the instructions in [`skill/SKILL.md`](skill/SKILL.md) (everything below the frontmatter) into your agent's rules file: `AGENTS.md`, `.cursor/rules`, `GEMINI.md`, `CONVENTIONS.md`, and so on. Replace `__REPO_DIR__` with the path of this checkout.
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

The config file is `~/.config/live-discussion-outline/config.json` (override the path with `OUTLINE_CONFIG`):

```json
{ "dir": "~/Documents/outlines", "port": 4577 }
```

Outlines are stored as `<dir>/<project>/<date>-<topic>.md`, one folder per project, outside your repos. The page for a file is `http://localhost:<port>/<project>/<date>-<topic>`; `/` lists them all.

To apply new settings, stop the server (`pkill -f live-discussion-outline/server.js`) and start it again with `npm start` (or the next `/outline` starts it).

## Notes

- Binds to localhost only. Raw HTML in the markdown is escaped. The server log is `live-discussion-outline.log` in your temp folder.
- Headings and list items that own a sub-list become collapsible. The markdown stays readable in any viewer.
- The 📋 button only copies to the clipboard. Injecting text into an existing chat through an editor URI handler did not work when tried.

## License

MIT
