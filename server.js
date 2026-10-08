import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { renderMarkdown, renderPlain, renderPage, escapeHtml } from './render.js'
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

function titleOf(file, fallback) {
    const heading = fs.readFileSync(file, 'utf8').split('\n').find(line => line.startsWith('# '))
    return heading ? heading.slice(2).trim() : fallback
}

function listMaps() {
    const out = []
    for (const project of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const f of fs.readdirSync(path.join(ROOT, project.name))) {
            if (!f.endsWith('.md')) continue
            const full = path.join(ROOT, project.name, f)
            const slug = f.slice(0, -3)
            out.push({ project: project.name, file: slug, title: titleOf(full, slug), mtime: fs.statSync(full).mtimeMs })
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
                return `<tr tabindex="0" data-href="${href}"><td>${escapeHtml(m.title)}</td><td>${escapeHtml(m.project)}</td><td>${escapeHtml(new Date(m.mtime).toLocaleString())}</td></tr>`
            })
            .join('')
        const body = `<h1>Live discussion outlines</h1><table class="index"><thead><tr><th>Name</th><th>Repo</th><th>Updated</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No outlines yet.</td></tr>'}</tbody></table>`
        return send(res, 200, 'text/html; charset=utf-8', renderPage({ title: 'Live discussion outlines', bodyHtml: body, storageKey: 'index' }))
    }

    const parts = pathname.split('/').filter(Boolean)
    if (parts.length === 2 && parts.every(p => !p.includes('..') && !p.includes('\\'))) {
        const file = path.join(ROOT, parts[0], `${parts[1]}.md`)
        if (path.resolve(file).startsWith(ROOT + path.sep) && fs.existsSync(file)) {
            let bodyHtml, plainHtml
            try {
                const source = fs.readFileSync(file, 'utf8')
                bodyHtml = renderMarkdown(source)
                plainHtml = renderPlain(source)
            } catch (e) {
                return send(res, 500, 'text/plain', `render failed: ${e.message}`)
            }
            return send(res, 200, 'text/html; charset=utf-8', renderPage({ title: parts[1], bodyHtml, plainHtml, storageKey: `map:${parts[0]}/${parts[1]}` }))
        }
    }
    send(res, 404, 'text/plain', 'not found')
})

server.listen(PORT, HOST, () => console.log(`live-discussion-outline on http://localhost:${PORT} watching ${ROOT}`))
