#!/usr/bin/env node
// The plugin's hooks. With each prompt the agent is handed what the user did on the outline's page since it was last
// told; after compaction or resume it gets the outline's map again. What this prints is added to the agent's context.
// A session without an outline, or with no server running, gets nothing, and never an error.
import { call, findServer } from './lib.js'

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const event = JSON.parse(input || '{}')
    const name = event.hook_event_name
    const tool = name === 'UserPromptSubmit' ? 'pending' : name === 'SessionStart' && ['resume', 'compact'].includes(event.source) ? 'reload' : ''
    if (!tool) return
    const port = await findServer()
    if (!port) return
    const { text } = await call(port, tool, { session: event.session_id || '', cwd: event.cwd || process.cwd() }, 3000)
    if (text) console.log(text)
}

main().catch(() => {}).finally(() => process.exit(0))
