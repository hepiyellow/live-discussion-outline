import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { renderMarkdown, renderPlain, renderPage, escapeHtml, countCheckboxProgress } from './render.js'
import { loadConfig } from './config.js'

const { dir: ROOT, port: PORT, host: HOST } = loadConfig()

fs.mkdirSync(ROOT, { recursive: true })

const clients = new Set()
let debounce
fs.watch(ROOT, { recursive: true }, () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
        for (const res of clients) res.write('data: change\n\n')
    }, 120)
})

const STATUS_KEYS = ['✅', '❓', '🔥']

const RESUME_LINE = 'Resume: '

/** Pulls the `Resume: <link or command>` line (if any) out of the source; the value is copied verbatim by the page. */
function extractResume(source) {
    const lines = source.split('\n')
    const i = lines.slice(0, 8).findIndex(line => line.startsWith(RESUME_LINE))
    if (i < 0) return { resume: '', source }
    const value = lines[i].slice(RESUME_LINE.length).trim().replace(/^`+|`+$/g, '')
    lines.splice(i, 1)
    return { resume: value.length <= 500 ? value : '', source: lines.join('\n') }
}

const MODEL_LINE = 'Model: '

/** Pulls the `Model: <name>, <effort>` line (if any) out of the source; the page shows it as written. */
function extractModel(source) {
    const lines = source.split('\n')
    const i = lines.slice(0, 8).findIndex(line => line.startsWith(MODEL_LINE))
    if (i < 0) return { model: '', source }
    const value = lines[i].slice(MODEL_LINE.length).trim().replace(/^`+|`+$/g, '')
    lines.splice(i, 1)
    return { model: value.length <= 100 ? value : '', source: lines.join('\n') }
}

/** Title from the first "# " line, plus counts of status emoji on headings and bullets. */
function summarize(file, fallback) {
    const { resume, source: afterResume } = extractResume(fs.readFileSync(file, 'utf8'))
    const { source } = extractModel(afterResume)
    const lines = source.split('\n')
    const heading = lines.find(line => line.startsWith('# '))
    const counts = { done: 0, open: 0, now: 0 }
    for (const line of lines) {
        const text = line.trimStart().replace(/^(#+|[-*])\s+/, '')
        if (text === line.trimStart()) continue
        if (text.startsWith(STATUS_KEYS[0]) || /^(\d+(\.\d+)*\.?\s+)?@resolved\b/i.test(text)) counts.done++
        else if (text.startsWith(STATUS_KEYS[1])) counts.open++
        else if (text.startsWith(STATUS_KEYS[2])) counts.now++
    }
    return { title: heading ? heading.slice(2).trim() : fallback, counts, checkbox: countCheckboxProgress(source), resume }
}

function listMaps() {
    const out = []
    for (const project of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const f of fs.readdirSync(path.join(ROOT, project.name))) {
            if (!f.endsWith('.md')) continue
            const full = path.join(ROOT, project.name, f)
            const slug = f.slice(0, -3)
            out.push({ project: project.name, file: slug, ...summarize(full, slug), mtime: fs.statSync(full).mtimeMs })
        }
    }
    return out.sort((a, b) => b.mtime - a.mtime)
}

function send(res, status, type, body) {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/health') return send(res, 200, 'text/plain', 'ok')

    if (pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write('retry: 1000\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
    }

    if (pathname === '/') {
        const rows = listMaps()
            .map(m => {
                const href = `/${encodeURIComponent(m.project)}/${encodeURIComponent(m.file)}`
                const cb = m.checkbox
                let progress
                if (cb.total) {
                    const hPct = Math.round((cb.done / cb.total) * 100)
                    const aPct = Math.round((cb.agent / cb.total) * 100)
                    progress = `<div class="progress" title="${cb.done} human-approved · ${cb.agent} agent-approved · ${cb.open} open (of ${cb.total} checkboxes)"><div class="meter"><span class="human" style="width:${hPct}%"></span><span class="agent" style="width:${aPct}%"></span></div><span class="nums">✅ ${cb.done} · <span class="agent-n">${cb.agent}</span> agent · ☐ ${cb.open}</span></div>`
                } else {
                    const { done, open, now } = m.counts
                    const total = done + open + now
                    const pct = total ? Math.round((done / total) * 100) : 0
                    progress = `<div class="progress" title="${done} resolved of ${total}"><div class="meter"><span class="human" style="width:${pct}%"></span></div><span class="nums">✅ ${done} · ❓ ${open}</span></div>`
                }
                return `<tr tabindex="0" data-href="${href}"><td>${escapeHtml(m.title)}</td><td>${escapeHtml(m.project)}</td><td class="progress-cell">${progress}</td><td>${m.resume ? `<button class="copy" data-copy="${escapeHtml(m.resume)}" title="Copy the link that reopens this chat">📋</button>` : ''}</td><td>${escapeHtml(new Date(m.mtime).toLocaleString().replace(',', ''))}</td></tr>`
            })
            .join('')
        const body = `<h1>Discussions</h1><table class="index"><thead><tr><th>Name</th><th>Repo</th><th>Progress</th><th>Chat</th><th>Updated</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No outlines yet.</td></tr>'}</tbody></table>`
        return send(res, 200, 'text/html; charset=utf-8', renderPage({ title: 'Discussions', bodyHtml: body, storageKey: 'index' }))
    }

    const parts = pathname.split('/').filter(Boolean)
    if (parts.length === 2 && parts.every(p => !p.includes('..') && !p.includes('\\'))) {
        const file = path.join(ROOT, parts[0], `${parts[1]}.md`)
        if (path.resolve(file).startsWith(ROOT + path.sep) && fs.existsSync(file)) {
            let tableHtml, plainHtml, resume, model
            try {
                const extracted = extractResume(fs.readFileSync(file, 'utf8'))
                const withModel = extractModel(extracted.source)
                const source = withModel.source
                resume = extracted.resume
                model = withModel.model
                tableHtml = renderMarkdown(source, 'table')
                plainHtml = renderPlain(source)
            } catch (e) {
                return send(res, 500, 'text/plain', `render failed: ${e.message}`)
            }
            return send(res, 200, 'text/html; charset=utf-8', renderPage({ title: parts[1], tableHtml, plainHtml, resume, model, storageKey: `map:${parts[0]}/${parts[1]}` }))
        }
    }
    send(res, 404, 'text/plain', 'not found')
})

server.listen(PORT, HOST, () => console.log(`live-discussion-outline on http://localhost:${PORT} watching ${ROOT}`))
