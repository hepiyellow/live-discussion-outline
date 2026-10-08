# Live Discussion Outline

When Claude answers with several numbered points and you drill into one, then go back to another, the chat scrolls away from you. This tool mirrors the conversation into a markdown outline that Claude keeps up to date, and serves it as a collapsible web page that reloads itself on every change.

- Every point and sub-point is numbered with its full path (`1`, `1.1`, `2.3.1`), in the chat and in the page, so "2.1" means the same thing in both places.
- Status emoji on each item: ❓ open, 🔥 being discussed now, ✅ resolved. Resolved items start collapsed; the 🔥 item is highlighted.
- Page bar: expand all, collapse all, jump to 🔥, hide ✅. Which items you opened or closed, and your scroll position, survive reloads.
- Hover a row and click 💬 to copy a reference (`Re: outline "…" › 2.1 …`) to paste into the chat and continue about that item.
- Claude only writes markdown (cheap to edit, easy to diff). The server renders it.

## Setup

Requires Node 18+ and [Claude Code](https://claude.com/claude-code).

```bash
git clone https://github.com/hepiyellow/live-discussion-outline
cd live-discussion-outline
npm install
npm run install-skill     # installs the /outline skill into ~/.claude/skills/outline
```

Then, in any Claude Code conversation, type `/outline` (optionally `/outline some topic`). Claude starts the server if it is not running, writes the outline, and replies with a link. Open it in a browser, or in an editor tab (in Cursor/VS Code: command palette → **Simple Browser: Show**, paste the URL).

The skill is user-invoked only (`disable-model-invocation: true`); Claude never starts an outline on its own. Remove that line from `skill/SKILL.md` and re-run `npm run install-skill` if you want it to.

## Configuration

Settings come from environment variables, then the config file, then defaults.

| Setting | Env var | Config file key | Default |
| ------- | ------- | --------------- | ------- |
| Folder for the markdown outlines | `OUTLINE_DIR` | `dir` | `~/.claude/outlines` |
| Server port | `OUTLINE_PORT` | `port` | `4577` |
| Bind address | `OUTLINE_HOST` | `host` | `127.0.0.1` |

The config file is `~/.config/live-discussion-outline/config.json` (override the path with `OUTLINE_CONFIG`):

```json
{ "dir": "~/Documents/outlines", "port": 4577 }
```

Outlines are stored as `<dir>/<project>/<date>-<topic>.md`, one folder per project, outside your repos. The page for a file is `http://localhost:<port>/<project>/<date>-<topic>`; `/` lists them all.

To apply new settings, stop the server (`pkill -f live-discussion-outline/server.js`); the next `/outline` starts it again. Run it by hand with `npm start`.

## Notes

- Binds to localhost only. Raw HTML in the markdown is escaped. The server log is `live-discussion-outline.log` in your temp folder.
- Headings and list items that own a sub-list become collapsible. The markdown stays readable in any viewer.
- The 💬 button only copies to the clipboard. Cursor's Claude extension registers a `cursor://anthropic.claude-code/open?prompt=` link, but it did not inject text into an existing chat when tried.

## License

MIT
