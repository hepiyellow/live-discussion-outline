import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { renderPlain, escapeHtml } from './render.js'

// The Transcript tab: Claude Code's session log (~/.claude/projects/<project>/<session id>.jsonl), streamed as
// rendered messages over server-sent events. The log format is Claude Code's internal one and may change.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')

export const isSessionId = id => ID_RE.test(id)

function findTranscript(id) {
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

const toolUse = block =>
    `<details class="tool" data-id="${escapeHtml(block.id)}"><summary><span class="tn">${escapeHtml(toolName(block.name))}</span> ${escapeHtml(toolSummary(block.input || {}))}</summary><pre class="ti">${escapeHtml(clip(JSON.stringify(block.input, null, 2), 4000))}</pre></details>`

const resultText = content =>
    typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') : ''

const userMessage = (text, note) =>
    `<div class="m u">${note ? `<span class="via">${escapeHtml(note)}</span>` : ''}${escapeHtml(text.trim())}</div>`

const systemLine = text => `<div class="m sys">${escapeHtml(text.trim())}</div>`

/** User-side text: plain prompts, plus the tagged forms Claude Code stores for slash commands, `!` commands and channel events. */
function userText(text, note) {
    let m
    if (text.startsWith('<system-reminder>') || text.startsWith('<local-command-caveat>') || text.startsWith('<bash-stdout>')) return null
    // A slash command: <command-message>, <command-name> and <command-args> tags, in no fixed order.
    if (text.startsWith('<command-') && (m = text.match(/<command-name>([^<]*)<\/command-name>/))) return userMessage(`${m[1]} ${(text.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''}`)
    if ((m = text.match(/^<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/))) return systemLine(m[1])
    if ((m = text.match(/^<bash-input>([\s\S]*?)<\/bash-input>/))) return userMessage(`! ${m[1]}`, note)
    if ((m = text.match(/^<channel [^>]*>\n?([\s\S]*?)\n?<\/channel>/))) return userMessage(m[1], 'via channel')
    return userMessage(text, note)
}

/**
 * One log entry → items for the page: `{ html }` to append, `{ result, html }` to fill in the tool call with that id, or
 * `{ title, custom }` for the session's name (one set with /rename is custom and wins over the generated one).
 */
function renderEntry(e) {
    const out = []
    const push = html => html && out.push({ html })
    if (e.type === 'custom-title' && e.customTitle) return [{ title: e.customTitle, custom: true }]
    if (e.type === 'ai-title' && e.aiTitle) return [{ title: e.aiTitle, custom: false }]
    if (e.isSidechain) return out
    if (e.type === 'assistant') {
        for (const b of e.message?.content || []) {
            if (b.type === 'text' && b.text.trim()) push(`<div class="m a">${renderPlain(b.text)}</div>`)
            else if (b.type === 'tool_use') push(toolUse(b))
        }
    } else if (e.type === 'user' && !e.isMeta) {
        const content = e.message?.content
        if (typeof content === 'string') push(userText(content))
        else
            for (const b of content || []) {
                if (b.type === 'tool_result') out.push({ result: b.tool_use_id, html: `<pre class="tr${b.is_error ? ' err' : ''}">${escapeHtml(clip(resultText(b.content), 4000))}</pre>` })
                else if (b.type === 'text') push(userText(b.text))
            }
    } else if (e.type === 'attachment' && e.attachment?.type === 'queued_command' && e.attachment.humanTurn) {
        push(userText(e.attachment.prompt || '', 'sent while Claude was working'))
    }
    return out
}

/** GET /transcript?id=<session id>: sends everything so far, then each new entry as the session appends it. */
export function streamTranscript(req, res, id) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    const file = findTranscript(id)
    if (!file) return res.end('event: missing\ndata: \n\n')
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
            res.write('event: reset\ndata: \n\n')
        }
        if (size === offset) return
        const buf = Buffer.alloc(size - offset)
        const fd = fs.openSync(file, 'r')
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        offset = size
        const lines = (rest + decoder.write(buf)).split('\n')
        rest = lines.pop()
        const items = []
        for (const line of lines) {
            if (!line) continue
            try {
                items.push(...renderEntry(JSON.parse(line)))
            } catch {}
        }
        if (items.length) res.write(`data: ${JSON.stringify(items)}\n\n`)
    }
    pump()
    let timer
    const watcher = fs.watch(file, () => {
        clearTimeout(timer)
        timer = setTimeout(pump, 100)
    })
    req.on('close', () => {
        watcher.close()
        clearTimeout(timer)
    })
}
