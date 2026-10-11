#!/usr/bin/env node
// The plugin's hooks. With each prompt the agent is handed what the user did on the outline's page since it was last
// told; after compaction or resume it gets the outline's map again. What this prints is added to the agent's context.
// When the agent ends a turn without acknowledging ticks it was told of, the turn is held open once, with the reason.
// A session without an outline, or with no server running, gets nothing, and never an error.
import { call, findServer } from './lib.js'

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const event = JSON.parse(input || '{}')
    const name = event.hook_event_name
    // At the end of a turn: the ticks the agent was told of and has not acknowledged. Once per turn: a turn that goes on
    // because this hook held it open (`stop_hook_active`) ends when the agent ends it again.
    const ending = name === 'Stop' && !event.stop_hook_active
    const tool = name === 'UserPromptSubmit' ? 'pending' : name === 'SessionStart' && ['resume', 'compact'].includes(event.source) ? 'reload' : ending ? 'ending' : ''
    if (!tool) return
    const port = await findServer()
    if (!port) return
    const { text } = await call(port, tool, { session: event.session_id || '', cwd: event.cwd || process.cwd() }, 3000)
    if (!text) return
    // Holding the turn open hands the agent the reason; the other hooks add their text to its context.
    console.log(ending ? JSON.stringify({ decision: 'block', reason: text }) : text)
}

main().catch(() => {}).finally(() => process.exit(0))
