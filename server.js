import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TITLE_MAX, countCheckboxProgress, extractHeaders, outlinePayload } from './outline.js'
import { loadConfig } from './config.js'
import { attachTerminals, fromLocalPage, hasSession, sendToTerminal } from './terminal.js'
import { isSessionId, streamActivity, streamMessages, streamTranscriptEntries } from './transcript.js'
import { findWorkspaces, listDirs, recentSessions, runningSessions, sessionFolder, startSession } from './start.js'
import { slashCommands } from './commands.js'
import { STATE_DIR, createStateStore } from './state.js'

const config = loadConfig()
const { dir: ROOT, port: PORT, host: HOST } = config

const HERE = path.dirname(fileURLToPath(import.meta.url))

fs.mkdirSync(ROOT, { recursive: true })

const TRASH = '.trash'

let debounce
const viewerState = createStateStore(ROOT)
// Writes to the viewer state and the trash are not outline changes.
const IGNORED = new Set([STATE_DIR, TRASH])
const changed = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
        pushOutlines()
        pushList()
    }, 120)
}
function watchOutlines() {
    const watcher = fs.watch(ROOT, { recursive: true }, (_, name) => {
        if (name && IGNORED.has(name.split(/[/\\]/)[0])) return
        changed()
    })
    // On Linux the recursive watcher fails when a folder it watches is removed (a project folder, .state/): start a
    // new one, and look again for changes the old one may have missed.
    watcher.on('error', e => {
        console.error(`outlines folder watcher: ${e.message}`)
        watcher.close()
        setTimeout(() => {
            watchOutlines()
            changed()
        }, 100)
    })
}
watchOutlines()

/** Open streams of the outline list, each with the list it last sent. */
const listStreams = new Map()

/** The outline list's JSON: every outline, newest first, and whether this server can show terminals. */
function outlineList() {
    return JSON.stringify({ outlines: listMaps(), terminals: terminalEnabled })
}

/** Sends each stream of the outline list the list again if it changed. */
function pushList() {
    if (!listStreams.size) return
    let data
    try {
        data = outlineList()
    } catch (e) {
        return console.error(`outline list: ${e.message}`)
    }
    for (const [res, last] of listStreams) {
        if (data === last) continue
        res.write(`data: ${data}\n\n`)
        listStreams.set(res, data)
    }
}

/** GET /api/outlines: the outline list. /api/outlines/events streams it, sent again whenever it changes. */
function listApi(req, res, events) {
    const data = outlineList()
    if (!events) return send(res, 200, 'application/json', data)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 1000\n\ndata: ${data}\n\n`)
    listStreams.set(res, data)
    req.on('close', () => listStreams.delete(res))
}

/** Open outline streams, by outline: each stream with the payload it last sent. */
const outlineStreams = new Map()

/** The file of outline <project>/<file>, or null when there is no such outline. */
function outlineFile(project, file) {
    if (!safeName(project) || !safeName(file)) return null
    const full = path.join(ROOT, project, `${file}.md`)
    return fs.existsSync(full) ? full : null
}

/** The outline's JSON (web/src/types.ts), or null when there is no such outline. */
function readOutline(project, file) {
    const full = outlineFile(project, file)
    if (!full) return null
    const outline = outlinePayload(fs.readFileSync(full, 'utf8'))
    return { project, file, ...outline, folder: (outline.session && sessionFolder(outline.session)) || '', terminalTab: terminalEnabled && !!outline.terminal }
}

/** Sends each outline stream its outline again if it changed, or `gone` once the file is no longer there. */
function pushOutlines() {
    for (const [key, streams] of outlineStreams) {
        const [project, file] = JSON.parse(key)
        let outline
        try {
            outline = readOutline(project, file)
        } catch (e) {
            console.error(`outline ${project}/${file}: ${e.message}`)
            continue
        }
        const data = outline ? JSON.stringify(outline) : null
        for (const [res, last] of streams) {
            if (data === last) continue
            res.write(data ? `data: ${data}\n\n` : 'event: gone\ndata: \n\n')
            streams.set(res, data)
        }
    }
}

/**
 * GET /api/state/<project>/<file>: the viewer's state of that outline (state.js). PATCH changes single entries, and
 * every open stream of the outline gets the new state, so two windows agree.
 */
async function stateApi(req, res, parts) {
    const [project, file] = parts
    if (parts.length !== 2 || !outlineFile(project, file)) return send(res, 404, 'text/plain', 'no such outline')
    if (req.method === 'GET') return json(res, 200, viewerState.read(project, file))
    if (req.method !== 'PATCH') return send(res, 405, 'text/plain', 'method not allowed')
    if (!fromLocalPage(req, PORT, { write: true }) || !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 403, 'text/plain', 'forbidden')
    let state
    try {
        state = viewerState.patch(project, file, await readJson(req))
    } catch (e) {
        return json(res, 400, { error: e.message })
    }
    const event = `event: state\ndata: ${JSON.stringify(state)}\n\n`
    for (const stream of outlineStreams.get(JSON.stringify([project, file]))?.keys() ?? []) stream.write(event)
    json(res, 200, state)
}

/** GET /api/outline/<project>/<file>[/events]: the outline's JSON, or a stream of it, sent again on each change of that file. */
function outlineApi(req, res, parts) {
    const [project, file, events] = parts
    if (parts.length > 3 || (events !== undefined && events !== 'events')) return send(res, 404, 'text/plain', 'not found')
    const outline = readOutline(project, file)
    if (!outline) return send(res, 404, 'text/plain', 'no such outline')
    const data = JSON.stringify(outline)
    if (!events) return send(res, 200, 'application/json', data)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 1000\n\ndata: ${data}\n\nevent: state\ndata: ${JSON.stringify(viewerState.read(project, file))}\n\n`)
    const key = JSON.stringify([project, file])
    if (!outlineStreams.has(key)) outlineStreams.set(key, new Map())
    outlineStreams.get(key).set(res, data)
    req.on('close', () => {
        const streams = outlineStreams.get(key)
        streams?.delete(res)
        if (!streams?.size) outlineStreams.delete(key)
    })
}

const STATUS_KEYS = ['✅', '❓', '🔥']

/** Title from the `Title:` line, plus counts of approved and open topics. */
function summarize(file, fallback) {
    const { title, resume, terminal, session, source } = extractHeaders(fs.readFileSync(file, 'utf8'))
    const lines = source.split('\n')
    const counts = { done: 0, open: 0, now: 0 }
    for (const line of lines) {
        const text = line.trimStart().replace(/^(#+|[-*])\s+/, '')
        if (text === line.trimStart()) continue
        if (text.startsWith(STATUS_KEYS[0]) || /^(\d+(\.\d+)*\.?\s+)?@approved\b/i.test(text)) counts.done++
        else if (text.startsWith(STATUS_KEYS[1])) counts.open++
        else if (text.startsWith(STATUS_KEYS[2])) counts.now++
    }
    return { title: title || fallback, counts, checkbox: countCheckboxProgress(source), resume, terminal, session }
}

function json(res, status, value) {
    send(res, status, 'application/json', JSON.stringify(value))
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', chunk => (body += chunk))
        req.on('end', () => {
            try {
                resolve(JSON.parse(body))
            } catch (e) {
                reject(e)
            }
        })
    })
}

/** Routes behind "New session": what can be started, starting it, and finding the outline it writes. */
async function startApi(req, res, pathname, url) {
    const write = req.method === 'POST'
    if (!fromLocalPage(req, PORT, { write }) || (write && !/^application\/json\b/.test(req.headers['content-type'] || ''))) return send(res, 403, 'text/plain', 'forbidden')
    try {
        if (pathname === '/api/start-options') {
            const running = runningInApp()
            return json(res, 200, { workspaces: findWorkspaces(config.workspaceDirs), sessions: recentSessions().map(s => ({ ...s, openIn: running.get(s.id) })) })
        }
        if (pathname === '/api/commands') {
            const session = url.searchParams.get('session') || ''
            const id = isSessionId(session) ? session : ''
            return json(res, 200, slashCommands(id, id ? sessionFolder(id) : undefined))
        }
        if (pathname === '/api/dirs') return json(res, 200, listDirs(url.searchParams.get('path')))
        if (pathname === '/api/start' && write) {
            const request = await readJson(req)
            const inTmux = request.kind === 'resume' && runningInApp().get(request.id)
            if (inTmux?.tmux) return json(res, 409, { error: `This session is already running in tmux session ${inTmux.tmux}.`, openIn: inTmux })
            return json(res, 200, { terminal: await startSession(request, config) })
        }
        if (pathname === '/api/delete' && write) return json(res, 200, trashOutline(await readJson(req)))
        if (pathname === '/api/rename' && write) return json(res, 200, renameOutline(await readJson(req)))
        if (pathname === '/api/outline-for') {
            const m = listMaps().find(o => o.terminal && o.terminal === url.searchParams.get('terminal'))
            return json(res, 200, m ? { href: `/${encodeURIComponent(m.project)}/${encodeURIComponent(m.file)}`, key: `map:${m.project}/${m.file}`, project: m.project, file: m.file } : {})
        }
        send(res, 404, 'text/plain', 'not found')
    } catch (e) {
        json(res, e.openIn ? 409 : 400, { error: e.message, openIn: e.openIn })
    }
}

/** Running sessions, plus those an outline links to a live tmux session (idle ones show no process to find). */
function runningInApp() {
    const running = runningSessions()
    for (const { session, terminal } of listMaps())
        if (session && terminal && !running.get(session)?.tmux && hasSession(terminal)) running.set(session, { app: `tmux session ${terminal}`, tmux: terminal })
    return running
}

const safeName = name => typeof name === 'string' && name && !name.startsWith('.') && !/[/\\]/.test(name)

/** The pencil beside a discussion's title: rewrites the outline's `Title:` line, leaving the rest of the file as it is. */
function renameOutline({ project, file, title }) {
    if (!safeName(project) || !safeName(file)) throw new Error('bad outline name')
    if (typeof title !== 'string') throw new Error('bad title')
    // The page strips backticks around a `Title:` value, so store it the way it will be read back.
    const name = title.replace(/\s+/g, ' ').trim().replace(/^`+|`+$/g, '').trim()
    if (!name) throw new Error('The name cannot be empty.')
    if (name.length > TITLE_MAX) throw new Error(`The name can be at most ${TITLE_MAX} characters.`)
    const full = path.join(ROOT, project, `${file}.md`)
    if (!fs.existsSync(full)) throw new Error('no such outline')
    const lines = fs.readFileSync(full, 'utf8').split('\n')
    const i = lines.slice(0, 8).findIndex(line => line.startsWith('Title: '))
    if (i < 0) throw new Error('This outline has no Title line.')
    lines[i] = `Title: ${name}${lines[i].endsWith('\r') ? '\r' : ''}`
    fs.writeFileSync(full, lines.join('\n'))
    return { title: name }
}

/** "Delete" in the outline list: moves the outline into <dir>/.trash/<project>/, where it can be moved back by hand. */
function trashOutline({ project, file }) {
    if (!safeName(project) || !safeName(file)) throw new Error('bad outline name')
    const from = path.join(ROOT, project, `${file}.md`)
    if (!fs.existsSync(from)) throw new Error('no such outline')
    const dir = path.join(ROOT, TRASH, project)
    fs.mkdirSync(dir, { recursive: true })
    let to = path.join(dir, `${file}.md`)
    if (fs.existsSync(to)) to = path.join(dir, `${file}-${Date.now()}.md`)
    fs.renameSync(from, to)
    return { trashed: to }
}

function listMaps() {
    const out = []
    for (const project of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (!project.isDirectory() || project.name.startsWith('.')) continue
        for (const f of fs.readdirSync(path.join(ROOT, project.name))) {
            if (!f.endsWith('.md')) continue
            const full = path.join(ROOT, project.name, f)
            const slug = f.slice(0, -3)
            out.push({ project: project.name, file: slug, ...summarize(full, slug), mtime: fs.statSync(full).mtimeMs })
        }
    }
    return out.sort((a, b) => b.mtime - a.mtime)
}

/** The page: a React app (ADR 0001), built into web/dist by `npm install`. */
const APP_DIST = path.join(HERE, 'web', 'dist')
const APP_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}

/** A file of the build, or else the app's shell, so that client routes (/, /<project>/<file>, /live) load the app. */
function serveApp(res, pathname) {
    const rel = pathname.slice(1)
    const file = path.resolve(APP_DIST, rel)
    if (rel && file.startsWith(APP_DIST + path.sep) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        // File names under assets/ carry a hash of their content, so they never change.
        const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store'
        res.writeHead(200, { 'content-type': APP_TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache })
        return fs.createReadStream(file).pipe(res)
    }
    // A missing file is not a client route: answering it with the shell would hide a broken build.
    if (rel.startsWith('assets/') || /\.(js|css|map|svg|png|ico|woff2?)$/.test(rel)) return send(res, 404, 'text/plain', 'not found')
    const index = path.join(APP_DIST, 'index.html')
    if (!fs.existsSync(index)) return send(res, 503, 'text/plain', 'The app is not built: run `npm run build`, or start the server with --dev.')
    send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(index))
}

function send(res, status, type, body) {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/health') return send(res, 200, 'text/plain', 'ok')

    // The app was served under /app/ while the old page still had these paths; links to it still work.
    if (pathname === '/app' || pathname.startsWith('/app/')) {
        res.writeHead(301, { location: (url.pathname.slice('/app'.length) || '/') + url.search })
        return res.end()
    }

    // The message box's spinner: whether the session's agent is in a turn.
    // The inbox: the agent's @message notes from the transcript.
    if (pathname === '/messages') {
        const id = url.searchParams.get('id') || ''
        if (!fromLocalPage(req, PORT, { write: false }) || !isSessionId(id)) return send(res, 403, 'text/plain', 'forbidden')
        return streamMessages(req, res, id)
    }

    if (pathname === '/activity') {
        const id = url.searchParams.get('id') || ''
        if (!fromLocalPage(req, PORT, { write: false }) || !isSessionId(id)) return send(res, 403, 'text/plain', 'forbidden')
        return streamActivity(req, res, id)
    }

    // The Transcript tab's input box: types the message into the outline's tmux session.
    if (pathname === '/send' && req.method === 'POST') {
        if (!fromLocalPage(req, PORT, { write: true }) || !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 403, 'text/plain', 'forbidden')
        readJson(req)
            .then(async ({ terminal, text }) => {
                if (typeof text !== 'string' || !text.trim() || text.length > 20000) return send(res, 400, 'text/plain', 'empty or too long')
                await sendToTerminal(String(terminal), text)
                send(res, 200, 'text/plain', 'sent')
            })
            .catch(e => send(res, 409, 'text/plain', e.message))
        return
    }

    if (pathname.startsWith('/api/outline/')) {
        if (!fromLocalPage(req, PORT, { write: false })) return send(res, 403, 'text/plain', 'forbidden')
        try {
            return outlineApi(req, res, pathname.slice('/api/outline/'.length).split('/'))
        } catch (e) {
            return send(res, 500, 'text/plain', `render failed: ${e.message}`)
        }
    }

    if (pathname === '/api/outlines' || pathname === '/api/outlines/events') {
        if (!fromLocalPage(req, PORT, { write: false })) return send(res, 403, 'text/plain', 'forbidden')
        return listApi(req, res, pathname.endsWith('/events'))
    }

    if (pathname.startsWith('/api/state/')) {
        if (!fromLocalPage(req, PORT, { write: false })) return send(res, 403, 'text/plain', 'forbidden')
        return stateApi(req, res, pathname.slice('/api/state/'.length).split('/'))
    }

    // The Transcript tab: the session's transcript as typed entries.
    if (pathname === '/api/transcript') {
        const id = url.searchParams.get('id') || ''
        if (!fromLocalPage(req, PORT, { write: false }) || !isSessionId(id)) return send(res, 403, 'text/plain', 'forbidden')
        return streamTranscriptEntries(req, res, id)
    }

    if (pathname.startsWith('/api/')) return startApi(req, res, pathname, url)

    // Everything else is the app: its files, or its shell for the routes it shows.
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed')
    if (vite) return vite.middlewares(req, res, () => send(res, 404, 'text/plain', 'not found'))
    serveApp(res, pathname)
})

const terminalEnabled = await attachTerminals(server, PORT)

/** With --dev, Vite serves the app from web/src as middleware and hot-reloads it over its own WebSocket on this server. */
const vite = process.argv.includes('--dev')
    ? await (await import('vite')).createServer({
          configFile: path.join(HERE, 'web', 'vite.config.ts'),
          server: { middlewareMode: true, hmr: { server } },
          appType: 'spa',
      })
    : undefined

// A WebSocket that neither the Terminal tab nor Vite's hot reload takes is closed.
server.on('upgrade', (req, socket) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    const terminal = terminalEnabled && pathname === '/term'
    const hotReload = vite && pathname === '/' && /^vite-/.test(req.headers['sec-websocket-protocol'] || '')
    if (!terminal && !hotReload) socket.destroy()
})

server.listen(PORT, HOST, () =>console.log(`live-discussion-outline on http://localhost:${PORT} watching ${ROOT}`))
