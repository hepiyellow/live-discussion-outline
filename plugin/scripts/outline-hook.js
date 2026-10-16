#!/usr/bin/env node
// The plugin's hooks. With each prompt the agent is handed what the user did on the outline's page since it was last
// told; after compaction or resume it gets the outline's map again. What this prints is added to the agent's context.
// When the agent ends a turn without acknowledging ticks it was told of, the turn is held open once, with the reason.
// At the end of a turn the server is handed the agent's final reply: it shows in the inbox when the turn changed nothing
// in the outline, since the user reads the page and not the chat.
// A permission prompt of the session shows on the outline's page too, and the user's answer there is handed back.
// A model switch the user asked for on the outline's page goes through without Claude Code's own question about it.
// A session without an outline, or with no server running, gets nothing, and never an error.
import { call, findServer } from './lib.js'

/**
 * How long the hook waits for the user's answer to a permission prompt on the outline's page, in milliseconds. The
 * server lets a prompt go before that (permission.js `ASK_MS`), and Claude Code stops the hook after it
 * (hooks.json `timeout`).
 */
const ANSWER_MS = 570_000

/**
 * Claude Code is about to ask the user for permission to use a tool. The outline's page shows the prompt too, and the
 * user's Allow or Deny there is this hook's answer. The terminal shows its own dialog meanwhile; when the user answers
 * there, or the page does not answer, the hook says nothing and the terminal's dialog stands.
 */
async function askPermission(event) {
    const port = await findServer()
    if (!port) return
    const body = { session: event.session_id || '', cwd: event.cwd || process.cwd(), tool: event.tool_name || '', input: event.tool_input ?? {}, mode: event.permission_mode || '' }
    const { decision, message } = await call(port, 'permission', body, ANSWER_MS)
    if (decision !== 'allow' && decision !== 'deny') return
    const answer = decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: message || 'The user denied this on the outline page.' }
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: answer } }))
}

/**
 * Claude Code is about to switch the session's model. When the outline's page asked for the switch (its model picker
 * typed `/model`), the pick there was the user's decision, and Claude Code skips its question about it ("Switch
 * model?"), which the page cannot show and the next thing typed into the session would answer. Any other switch gets
 * no answer here, and Claude Code asks as it does without this hook.
 */
async function askSwitching(event) {
    const port = await findServer()
    if (!port) return
    const { asked } = await call(port, 'switching', { session: event.session_id || '', cwd: event.cwd || process.cwd() }, 2000)
    if (asked) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreModelSwitch', permissionDecision: 'allow' } }))
}

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const event = JSON.parse(input || '{}')
    const name = event.hook_event_name
    if (name === 'PermissionRequest') return askPermission(event)
    if (name === 'PreModelSwitch') return askSwitching(event)
    // At the end of a turn: the server answers with the ticks the agent was told of and has not acknowledged, and the
    // turn is held open with them. Once per turn: the server does not hold a turn that already goes on because of this
    // hook (`stop_hook_active`).
    const ending = name === 'Stop'
    const tool = name === 'UserPromptSubmit' ? 'pending' : name === 'SessionStart' && ['resume', 'compact'].includes(event.source) ? 'reload' : ending ? 'ending' : ''
    if (!tool) return
    const port = await findServer()
    if (!port) return
    const turn = ending ? { active: !!event.stop_hook_active, reply: typeof event.last_assistant_message === 'string' ? event.last_assistant_message : '' } : {}
    const { text } = await call(port, tool, { session: event.session_id || '', cwd: event.cwd || process.cwd(), ...turn }, 3000)
    if (!text) return
    // Holding the turn open hands the agent the reason; the other hooks add their text to its context.
    console.log(ending ? JSON.stringify({ decision: 'block', reason: text }) : text)
}

main().catch(() => {}).finally(() => process.exit(0))
