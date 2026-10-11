import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { renderPlain } from './outline.js'

// The Transcript tab, the inbox and the spinner read Claude Code's session log
// (~/.claude/projects/<project>/<session id>.jsonl), streamed over server-sent events. The log format is Claude Code's
// internal one and may change.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')

export const isSessionId = id => ID_RE.test(id)

export function findTranscriptFile(id) {
    try {
        for (const dir of fs.readdirSync(PROJECTS)) {
            const file = path.join(PROJECTS, dir, `${id}.jsonl`)
            if (fs.existsSync(file)) return file
        }
    } catch {}
    return null
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… ${text.length - max} more characters` : text)

// mcp__Claude_Browser__find → find
const toolName = name => name.split('__').pop()

const toolSummary = input =>
    String(input.description || input.command || input.file_path || input.pattern || input.url || input.query || input.skill || input.prompt || '')
        .split('\n')[0]
        .slice(0, 160)

const resultText = content =>
    typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') : ''

/**
 * User-side text as a typed entry: plain prompts, plus the tagged forms Claude Code stores for slash commands, `!`
 * commands and channel events; a local command's output is a system line. Null for what the page does not show.
 */
function userEntry(text, note) {
    let m
    if (text.startsWith('<system-reminder>') || text.startsWith('<local-command-caveat>') || text.startsWith('<bash-stdout>')) return null
    const entry = (t, n, system = false) => ({ type: 'user-text', text: t.trim(), ...(n ? { note: n } : {}), ...(system ? { system } : {}) })
    if (text.startsWith('<command-') && (m = text.match(/<command-name>([^<]*)<\/command-name>/)))
        return entry(`${m[1]} ${(text.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''}`)
    if ((m = text.match(/^<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/))) return entry(m[1], undefined, true)
    if ((m = text.match(/^<bash-input>([\s\S]*?)<\/bash-input>/))) return entry(`! ${m[1]}`, note)
    if ((m = text.match(/^<channel [^>]*>\n?([\s\S]*?)\n?<\/channel>/))) return entry(m[1], 'via channel')
    return entry(text, note)
}

/**
 * One log entry → typed entries for the Transcript tab (web/src/types.ts): `assistant-text` (its markdown as HTML),
 * `user-text`, `tool-use`, `tool-result` (naming the tool call it answers) and `title` (one set with /rename is custom
 * and wins over the generated one).
 */
export function transcriptEntries(e) {
    if (e.type === 'custom-title' && e.customTitle) return [{ type: 'title', title: e.customTitle, custom: true }]
    if (e.type === 'ai-title' && e.aiTitle) return [{ type: 'title', title: e.aiTitle, custom: false }]
    if (e.isSidechain) return []
    const out = []
    if (e.type === 'assistant') {
        for (const b of e.message?.content || []) {
            if (b.type === 'text' && b.text.trim()) out.push({ type: 'assistant-text', html: renderPlain(b.text) })
            else if (b.type === 'tool_use')
                out.push({ type: 'tool-use', id: b.id, name: toolName(b.name), summary: toolSummary(b.input || {}), input: clip(JSON.stringify(b.input, null, 2), 4000) })
        }
    } else if (e.type === 'user' && !e.isMeta) {
        const content = e.message?.content
        if (typeof content === 'string') out.push(userEntry(content))
        else
            for (const b of content || []) {
                if (b.type === 'tool_result') out.push({ type: 'tool-result', toolUseId: b.tool_use_id, text: clip(resultText(b.content), 4000), error: !!b.is_error })
                else if (b.type === 'text') out.push(userEntry(b.text))
            }
    } else if (e.type === 'attachment' && e.attachment?.type === 'queued_command' && e.attachment.humanTurn) {
        out.push(userEntry(e.attachment.prompt || '', 'sent while Claude was working'))
    }
    return out.filter(Boolean)
}

/**
 * Follows a session's transcript: `onEntries(entries)` gets everything so far, then each batch the session appends;
 * `onReset()` runs if the file shrinks (rewritten). Returns a function that stops following, or null when there is no
 * transcript.
 */
function followFile(id, onEntries, onReset) {
    const file = findTranscriptFile(id)
    if (!file) return null
    let offset = 0
    let rest = ''
    let decoder = new StringDecoder('utf8')
    const pump = () => {
        let size
        try {
            size = fs.statSync(file).size
        } catch {
            return
        }
        if (size < offset) {
            offset = 0
            rest = ''
            decoder = new StringDecoder('utf8')
            onReset()
        }
        if (size === offset) return
        const buf = Buffer.alloc(size - offset)
        const fd = fs.openSync(file, 'r')
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        offset = size
        const lines = (rest + decoder.write(buf)).split('\n')
        rest = lines.pop()
        const entries = []
        for (const line of lines) {
            if (!line) continue
            try {
                entries.push(JSON.parse(line))
            } catch {}
        }
        if (entries.length) onEntries(entries)
    }
    pump()
    let timer
    const watcher = fs.watch(file, () => {
        clearTimeout(timer)
        timer = setTimeout(pump, 100)
    })
    return () => {
        watcher.close()
        clearTimeout(timer)
    }
}

/** Follows a session's transcript over a server-sent event stream of its own. Returns false when there is no transcript. */
function follow(req, res, id, onEntries, onReset) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    const stop = followFile(id, onEntries, onReset)
    if (!stop) {
        res.end('event: missing\ndata: \n\n')
        return false
    }
    req.on('close', stop)
    return true
}

/**
 * Whether the agent is in a turn after this entry: true once a prompt, a tool result or the agent's own output arrives;
 * false at the turn's end (Claude Code's turn_duration entry), after an interrupt, or after a local command's output.
 * Undefined for entries that say nothing about it.
 */
function busyAfter(e) {
    if (e.isSidechain) return undefined
    if (e.type === 'system' && e.subtype === 'turn_duration') return false
    if (e.type === 'assistant') return true
    if (e.type === 'attachment' && e.attachment?.type === 'queued_command') return true
    if (e.type !== 'user' || e.isMeta) return undefined
    const content = e.message?.content
    const text = typeof content === 'string' ? content : (content || []).find(b => b.type === 'text')?.text
    if (text?.startsWith('<local-command-stdout>') || text?.startsWith('[Request interrupted')) return false
    return true
}

/** GET /activity?id=<session id>: `busy` or `idle` now, then each change, for the message box's spinner. */
export function streamActivity(req, res, id) {
    let state
    follow(req, res, id, entries => {
        let busy = state
        for (const e of entries) busy = busyAfter(e) ?? busy
        const next = busy ? 'busy' : 'idle'
        if (next !== state) res.write(`event: state\ndata: ${next}\n\n`)
        state = next
    }, () => {})
}

/**
 * The model and effort the agent answered with in this entry: `{ model, effort, at }`, `at` being when it answered.
 * Claude Code writes both on each of the agent's replies. Undefined for entries that do not say (a reply Claude Code
 * made up itself, with the model `<synthetic>`, is one).
 */
function usingIn(e) {
    if (e.type !== 'assistant' || e.isSidechain) return undefined
    const model = e.message?.model
    if (typeof model !== 'string' || !model || model.startsWith('<')) return undefined
    return { model, effort: typeof e.effort === 'string' ? e.effort : '', at: e.timestamp || '' }
}

// The colors and cursor moves a terminal's output is drawn with.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
/** Most of a transcript's end that is read to find the local commands run lately. */
const TAIL_BYTES = 1_000_000
/** Longest output of a local command that is kept. */
const MAX_OUTPUT = 20_000

const tagged = (text, tag) => text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]

/** The text of a log entry that may be part of a local command: Claude Code writes those as `user` entries or as `system` ones. */
function commandText(e) {
    if (e.isSidechain) return ''
    if (e.type === 'system' && e.subtype === 'local_command') return typeof e.content === 'string' ? e.content : ''
    if (e.type !== 'user') return ''
    const content = e.message?.content
    return typeof content === 'string' ? content : (content || []).find(b => b.type === 'text')?.text || ''
}

const isCommandOutput = e => commandText(e).startsWith('<local-command-stdout>')

/**
 * The local commands with output in these log entries, in order: `{ id, at, command, output }`. A local command is one
 * Claude Code runs itself, without a turn of the agent (`/context`, `/model`): the log holds its name and arguments,
 * then its output. Where Claude Code also wrote the output as markdown for the agent, in the entry after it (as
 * `/context` does), that is the output: the terminal's own is drawn with colors and block characters.
 */
export function localCommandsIn(entries) {
    const out = []
    let command = ''
    entries.forEach((e, i) => {
        const text = commandText(e)
        if (!text) return
        if (text.startsWith('<command-')) {
            const name = tagged(text, 'command-name')
            if (name !== undefined) command = `${name} ${tagged(text, 'command-args') || ''}`.trim()
            return
        }
        if (!text.startsWith('<local-command-stdout>')) {
            // A prompt of the user's: whatever was named before it was not a local command.
            if (e.type === 'user' && !e.isMeta && !text.startsWith('<')) command = ''
            return
        }
        const next = entries[i + 1]
        const forAgent = next?.type === 'user' && next.isMeta && next.timestamp === e.timestamp ? commandText(next) : ''
        const output = (forAgent && !forAgent.startsWith('<') ? forAgent : (tagged(text, 'local-command-stdout') || '').replace(ANSI_RE, '')).trim()
        if (output) out.push({ id: `cmd:${e.uuid || e.timestamp}`, at: e.timestamp || '', command, output: clip(output, MAX_OUTPUT) })
        command = ''
    })
    return out
}

/** The local commands with output a session ran after `since` (an ISO time), from the end of its transcript; none without a transcript. */
export function localCommandsSince(id, since) {
    const file = isSessionId(id) ? findTranscriptFile(id) : null
    if (!file) return []
    let text
    try {
        const size = fs.statSync(file).size
        const from = Math.max(0, size - TAIL_BYTES)
        const buf = Buffer.alloc(size - from)
        const fd = fs.openSync(file, 'r')
        fs.readSync(fd, buf, 0, buf.length, from)
        fs.closeSync(fd)
        // Read from the middle of the file, the first line is the rest of one.
        text = from ? buf.toString('utf8').replace(/^[^\n]*\n/, '') : buf.toString('utf8')
    } catch {
        return []
    }
    const entries = []
    for (const line of text.split('\n')) {
        if (!line) continue
        try {
            entries.push(JSON.parse(line))
        } catch {}
    }
    return localCommandsIn(entries).filter(c => c.at > since)
}

/** A value as text that does not depend on the order its keys were written in. */
const stable = value =>
    JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v))

/**
 * Watches a session's transcript for the outcome of a tool call that waits for the user's permission: the call of
 * `tool` with exactly `input` that has no result yet. `onSettled()` is called once, when its result is written, which
 * Claude Code does as soon as the permission is answered, wherever that was (allowed and run, or denied). The call is
 * looked for at the transcript's end, and in what is written after: Claude Code may write it a moment late. Returns a
 * function that stops watching; without a transcript it watches nothing.
 */
export function watchToolCall(id, tool, input, onSettled) {
    const file = isSessionId(id || '') ? findTranscriptFile(id) : null
    if (!file) return () => {}
    const wanted = stable(input)
    const open = new Set()
    let offset = 0
    let rest = ''
    let decoder = new StringDecoder('utf8')
    let stopped = false
    let timer
    let watcher
    const stop = () => {
        stopped = true
        watcher?.close()
        clearTimeout(timer)
    }
    /** Takes entries in order, and says whether a call that was waiting got its result among them. */
    const take = entries => {
        let settled = false
        for (const e of entries) {
            if (e.isSidechain) continue
            const blocks = Array.isArray(e.message?.content) ? e.message.content : []
            if (e.type === 'assistant') {
                for (const b of blocks) if (b.type === 'tool_use' && b.name === tool && stable(b.input) === wanted) open.add(b.id)
            } else if (e.type === 'user') {
                for (const b of blocks) if (b.type === 'tool_result' && open.delete(b.tool_use_id)) settled = true
            }
        }
        return settled
    }
    const pump = first => {
        if (stopped) return
        let size
        try {
            size = fs.statSync(file).size
        } catch {
            return
        }
        if (size <= offset) return
        const buf = Buffer.alloc(size - offset)
        const fd = fs.openSync(file, 'r')
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        const lines = (rest + decoder.write(buf)).split('\n')
        // Read from the middle of the file, the first line is the rest of one.
        if (first && offset > 0) lines.shift()
        offset = size
        rest = lines.pop()
        const entries = []
        for (const line of lines) {
            if (!line) continue
            try {
                entries.push(JSON.parse(line))
            } catch {}
        }
        const settled = take(entries)
        // Results found at the first look belong to earlier calls of the same command: the one that waits has none yet.
        if (settled && !first) {
            stop()
            onSettled()
        }
    }
    try {
        offset = Math.max(0, fs.statSync(file).size - TAIL_BYTES)
    } catch {
        return () => {}
    }
    pump(true)
    watcher = fs.watch(file, () => {
        clearTimeout(timer)
        timer = setTimeout(() => pump(false), 100)
    })
    return stop
}

const MESSAGE_RE = /^@message\b\s*(?:(\d+(?:\.\d+)*)\.?(?=\s|$))?\s*([\s\S]*)$/i

/** The agent's `@message` paragraphs in one log entry: `{ id, at, num, html }`, num being the bullet it names (or ''). */
function messagesIn(e) {
    if (e.type !== 'assistant' || e.isSidechain) return []
    const out = []
    ;(e.message?.content || []).forEach((block, b) => {
        if (block.type !== 'text') return
        block.text.split(/\n\s*\n/).forEach((para, p) => {
            const m = para.trim().match(MESSAGE_RE)
            if (m && m[2].trim()) out.push({ id: `${e.uuid}:${b}:${p}`, at: e.timestamp, num: m[1] || '', html: renderPlain(m[2].trim()) })
        })
    })
    return out
}

/** GET /messages?id=<session id>: the session's messages so far (the last 100), then each new one. */
export function streamMessages(req, res, id) {
    let first = true
    follow(req, res, id, entries => {
        let found = entries.flatMap(messagesIn)
        if (first) found = found.slice(-100)
        first = false
        if (found.length) res.write(`data: ${JSON.stringify(found)}\n\n`)
    }, () => res.write('event: reset\ndata: \n\n'))
}

/**
 * Everything an outline's stream carries about its linked session, from one pass over the transcript, so the page needs
 * one connection, not one per kind: `send('messages', [...])` (the agent's @message notes: the last 100 so far, then
 * each new one), `send('activity', 'busy' | 'idle')`, `send('using', { model, effort, at })` (what the agent last
 * answered with, whenever it answers), `send('commands', null)` (a local command has printed its output: the caller
 * may want to look for it) and, when `transcript` is asked for, `send('transcript', [...])`
 * (typed entries). `send('session', id)` comes first, and again if the transcript is rewritten: what was sent before it
 * no longer holds. Returns a function that stops following, or null when there is no transcript.
 */
export function followSession(id, send, { transcript = false } = {}) {
    if (!findTranscriptFile(id)) return null
    let first = true
    let state
    send('session', id)
    return followFile(
        id,
        entries => {
            let found = entries.flatMap(messagesIn)
            if (first) found = found.slice(-100)
            first = false
            if (found.length) send('messages', found)
            let busy = state
            for (const e of entries) busy = busyAfter(e) ?? busy
            const next = busy ? 'busy' : 'idle'
            if (next !== state) send('activity', next)
            state = next
            const using = entries.map(usingIn).findLast(Boolean)
            if (using) send('using', using)
            if (entries.some(isCommandOutput)) send('commands', null)
            if (!transcript) return
            const items = entries.flatMap(transcriptEntries)
            if (items.length) send('transcript', items)
        },
        () => {
            first = true
            state = undefined
            send('session', id)
        },
    )
}
