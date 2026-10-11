import crypto from 'node:crypto'
import { watchToolCall } from './transcript.js'

// Permission prompts on the page. When Claude Code is about to ask the user for permission to use a tool, the plugin's
// PermissionRequest hook asks the server, and waits. The outline's page shows the prompt as a pop-up; the user's Allow
// or Deny there is the hook's answer, and Claude Code goes on as if they had answered in the terminal. The terminal
// shows its own dialog all the while, and an answer there wins: Claude Code does not tell the hook, so the server
// watches the session's transcript for the tool call's result and takes the prompt down when it comes.

/**
 * How long a prompt waits for the page. Shorter than the hook's own timeout (plugin/hooks/hooks.json), so the hook
 * always gets the server's answer. After it the prompt is the terminal's alone, and a message says so.
 */
export const ASK_MS = 9 * 60_000

/** Longest text of a tool's input the page is sent. */
const MAX_INPUT = 20_000

/** What a prompt asks, in a line: the command, the file or the address the tool is to use. */
export function promptSummary(tool, input) {
    const text = input && typeof input === 'object' ? input.command || input.file_path || input.path || input.url || input.pattern || input.query || input.description || '' : ''
    return String(text).split('\n')[0].slice(0, 200)
}

/**
 * The prompts waiting for the user, by outline. `onChange(project, file)` is called whenever an outline's list
 * changes, and `note(project, file, text)` leaves a message for a prompt the page let go of: one the user dismissed,
 * or one nobody answered in time. `watch` is transcript.js `watchToolCall`, replaced in tests.
 */
export function createPermissions({ onChange = () => {}, note = () => {}, askMs = ASK_MS, watch = watchToolCall } = {}) {
    const waiting = new Map()
    const keyOf = (project, file) => JSON.stringify([project, file])

    /** The prompts of an outline the page shows, oldest first: `{ id, at, tool, summary, input, mode }`. */
    const list = (project, file) => [...(waiting.get(keyOf(project, file))?.values() ?? [])].map(p => p.shown)

    /**
     * A prompt of the session of outline `project/file`: shows it, and answers `done` with `{ behavior, message }`
     * once the user allowed or denied it on the page, or with null when it is no longer the page's to answer
     * (answered in the terminal, dismissed, not answered in time, or `gone()`: the hook that asked has left).
     */
    function ask(project, file, { session = '', tool = '', input = {}, mode = '' }) {
        const key = keyOf(project, file)
        const id = crypto.randomUUID()
        let text = ''
        try {
            text = JSON.stringify(input, null, 2) ?? ''
        } catch {}
        const summary = promptSummary(tool, input)
        const shown = { id, at: new Date().toISOString(), tool: String(tool).slice(0, 200), summary, input: text.length > MAX_INPUT ? `${text.slice(0, MAX_INPUT)}\n…` : text, mode: String(mode).slice(0, 40) }
        let settle
        const done = new Promise(resolve => (settle = resolve))
        let stopWatching = () => {}
        let timer
        const end = (result, leaveNote) => {
            const prompts = waiting.get(key)
            if (!prompts?.has(id)) return false
            prompts.delete(id)
            if (!prompts.size) waiting.delete(key)
            clearTimeout(timer)
            stopWatching()
            if (leaveNote) note(project, file, `A permission prompt is waiting in the session's terminal: **${shown.tool}**${summary ? ` \`${summary.replaceAll('`', "'")}\`` : ''}. Answer it there.`)
            onChange(project, file)
            settle(result)
            return true
        }
        if (!waiting.has(key)) waiting.set(key, new Map())
        waiting.get(key).set(id, { shown, end })
        timer = setTimeout(() => end(null, true), askMs)
        timer.unref?.()
        stopWatching = watch(session, tool, input, () => end(null, false))
        onChange(project, file)
        return { id, done, gone: () => end(null, false) }
    }

    /** The user's answer on the page: `allow`, `deny`, or `dismiss` (the prompt stays the terminal's, and a message says so). False when the prompt is gone. */
    function answer(project, file, id, what) {
        const prompt = waiting.get(keyOf(project, file))?.get(id)
        if (!prompt) return false
        if (what === 'allow') return prompt.end({ behavior: 'allow' }, false)
        if (what === 'deny') return prompt.end({ behavior: 'deny', message: 'The user denied this on the outline page.' }, false)
        return prompt.end(null, true)
    }

    return { ask, answer, list }
}
