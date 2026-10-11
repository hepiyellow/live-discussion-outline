#!/usr/bin/env node
// The Start step of the file-mode skill (skills/outline-file): starts the outline server in the background if none is
// answering, then prints where things are, one `key=value` per line, for the agent to use when it writes the outline's
// file. Node's own modules only, like the rest of the plugin.
import { findServer, outlinesDir, settings, tmuxSession } from './lib.js'

const port = await findServer({ start: true })
if (!port) {
    console.error('The outline server is not running and could not be started. Open the Outline Only app, or run `npm start` in the outline-only checkout, then try again.')
    process.exit(1)
}
const { linkBase, resumeTemplate } = settings()
console.log(`dir=${outlinesDir()}`)
// The settings file's link base when it names one (the Outline app's own scheme), else the server's address.
console.log(`url=${linkBase || `http://localhost:${port}`}`)
console.log(`resume=${resumeTemplate || ''}`)
console.log(`terminal=${tmuxSession()}`)
// Claude Code passes its session id to the commands its agent runs; other agents leave this empty.
console.log(`session=${process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_THREAD_ID || ''}`)
// Set when the page started this session from a workspace: the outline files under the workspace's name.
console.log(`project=${process.env.OUTLINE_PROJECT || ''}`)
