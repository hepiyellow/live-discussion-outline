import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TITLE_MAX, countCheckboxProgress, extractHeaders, outlinePayload } from './outline.js'
import { HISTORY_DIR, createHistory } from './history.js'
import { loadConfig } from './config.js'
import { attachTerminals, fromLocalPage, hasSession, sendToTerminal, stopInTerminal } from './terminal.js'
import { followSession, isSessionId, streamActivity, streamMessages } from './transcript.js'
import { findWorkspaces, listDirs, recentSessions, runningSessions, sessionFolder, startedSessions, startSession } from './start.js'
import { slashCommands } from './commands.js'
import { STATE_DIR, createStateStore } from './state.js'
import { installLogging } from './log.js'
import { LEDGER_DIR, createAgentApi } from './agent.js'
import { OpError } from './model.js'

installLogging()
const config = loadConfig()
const { dir: ROOT, host: HOST } = config

/** `--port <n>`: the port a parent (the Outline app) asks for, where 0 is any free one. Without it, undefined. */
function portArgument() {
    const at = process.argv.indexOf('--port')
    if (at < 0) return undefined
    const value = process.argv[at + 1]
    if (!/^\d+$/.test(value ?? '') || Number(value) > 65535) {
        console.error(`--port takes a port number, not ${value ?? 'nothing'}`)
        process.exit(1)
    }
    return Number(value)
}
const ASKED_PORT = portArgument()
// The port listened on: the settings file's, or the one asked for; from `listening` on, the one actually taken.
let PORT = ASKED_PORT ?? config.port

const HERE = path.dirname(fileURLToPath(import.meta.url))

fs.mkdirSync(ROOT, { recursive: true })

const TRASH = '.trash'

let debounce
const viewerState = createStateStore(ROOT)
const history = createHistory(ROOT)
// Writes to the viewer state, the trash, the node history and the ledgers are not outline changes.
const IGNORED = new Set([STATE_DIR, TRASH, HISTORY_DIR, LEDGER_DIR])
// Outline files that changed since the last recording of their history: `project/file`.
const touched = new Set()
const changed = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
        recordTouched()
        pushOutlines()
        pushList()
    }, 120)
}
/** Records the history of each outline file that changed, from its text as it is now. */
function recordTouched() {
    for (const key of touched) {
        const [project, file] = JSON.parse(key)
        try {
            const full = outlineFile(project, file)
            if (full) history.record(project, file, fs.readFileSync(full, 'utf8'))
        } catch (e) {
            console.error(`history of ${project}/${file}: ${e.message}`)
        }
    }
    touched.clear()
}
function watchOutlines() {
    const watcher = fs.watch(ROOT, { recursive: true }, (_, name) => {
        if (name && IGNORED.has(name.split(/[/\\]/)[0])) return
        // A file directly in a project folder is an outline: `project/file.md`.
        const parts = name ? name.split(/[/\\]/) : []
        if (parts.length === 2 && parts[1].endsWith('.md') && safeName(parts[0])) touched.add(JSON.stringify([parts[0], parts[1].slice(0, -3)]))
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

/** The history of each outline as it was when the server started: its nodes, stamped with the file's last change. */
function baselineHistory() {
    for (const project of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (!project.isDirectory() || project.name.startsWith('.')) continue
        for (const f of fs.readdirSync(path.join(ROOT, project.name))) {
            if (!f.endsWith('.md')) continue
            try {
                const full = path.join(ROOT, project.name, f)
                history.record(project.name, f.slice(0, -3), fs.readFileSync(full, 'utf8'), fs.statSync(full).mtimeMs)
            } catch (e) {
                console.error(`history of ${project.name}/${f}: ${e.message}`)
            }
        }
    }
}
baselineHistory()

/**
 * The agent's side of the outlines (agent.js): the server writes every outline, and each write goes to the node history
 * and to the open pages at once, without waiting for the folder's watcher.
 */
const agent = createAgentApi({
    root: ROOT,
    config,
    // The settings file's link base when it names one (the Outline app's own scheme), else this server's address.
    linkBase: () => (config.linkBase === `http://localhost:${config.port}` ? `http://localhost:${PORT}` : config.linkBase),
    onWrite(project, file, text) {
        try {
            history.record(project, file, text)
        } catch (e) {
            console.error(`history of ${project}/${file}: ${e.message}`)
        }
        pushOutlines()
        pushList()
    },
    onMessages: (project, file) => pushNotes(project, file),
    typeInto: sendToTerminal,
})

/** Sends the open pages of an outline the agent's messages kept in its ledger (the `message` operation). */
function pushNotes(project, file) {
    const streams = outlineStreams.get(JSON.stringify([project, file]))
    if (!streams?.size) return
    const event = `event: notes\ndata: ${JSON.stringify(agent.messages(project, file))}\n\n`
    for (const res of streams.keys()) res.write(event)
}

/**
 * Open streams the outline list goes out on, each with the list it last sent and its event name: the list's own stream
 * sends it unnamed, an outline's stream as `outlines` events, for the pane beside the outline.
 */
const listStreams = new Map()

/**
 * The names of the workspaces New can start from (start.js `findWorkspaces`): a project with one of these names is a
 * workspace, and the pane lists it first. The scan reads recent sessions and lists folders, too slow for every list
 * sent, so its result is kept here: found once the server is up, again every few minutes, and whenever New scans anyway.
 */
let workspaceNames = []
function refreshWorkspaces(found) {
    let names
    try {
        names = [...new Set((found ?? findWorkspaces(config.workspaceDirs)).map(w => w.name))].sort()
    } catch (e) {
        return console.error(`workspaces: ${e.message}`)
    }
    if (names.join('\n') === workspaceNames.join('\n')) return
    workspaceNames = names
    pushList()
}
setInterval(refreshWorkspaces, 5 * 60 * 1000).unref()

// A starting session leaves the list when its outline appears (a change in the outlines folder) or when it ends, which
// nothing announces: look again every few seconds while the list has one.
setInterval(() => listHadStarting && pushList(), 3000).unref()

/** Whether the list last made had sessions starting: while it does, it is made again every few seconds (see below). */
let listHadStarting = false

/**
 * The outline list's JSON: every outline, newest first; the sessions New started whose outline has not appeared yet
 * (no outline names their tmux session on its `Terminal:` line); the workspaces' names; and whether this server can
 * show terminals.
 */
function outlineList() {
    const outlines = listMaps()
    const linked = new Set(outlines.map(o => o.terminal).filter(Boolean))
    const starting = startedSessions().filter(s => !linked.has(s.terminal))
    listHadStarting = starting.length > 0
    return JSON.stringify({ outlines, starting, workspaces: workspaceNames, terminals: terminalEnabled })
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
    for (const [res, { last, event }] of listStreams) {
        if (data === last) continue
        res.write(`${event ? `event: ${event}\n` : ''}data: ${data}\n\n`)
        listStreams.set(res, { last: data, event })
    }
}

/** GET /api/outlines: the outline list. /api/outlines/events streams it, sent again whenever it changes. */
function listApi(req, res, events) {
    const data = outlineList()
    if (!events) return send(res, 200, 'application/json', data)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 1000\n\ndata: ${data}\n\n`)
    listStreams.set(res, { last: data, event: '' })
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
            if (outline) followLinked(res, outline.session)
        }
    }
}

/** What each open outline stream follows of its outline's linked session: `{ session, transcript, stop }`. */
const linked = new Map()

/**
 * Puts the outline's linked session on its stream (transcript.js `followSession`), so the page holds one connection
 * however much it shows: a browser allows six to one server, across all its windows, and every further request waits.
 * Called again when the outline changes, it follows the session the outline links to now.
 */
function followLinked(res, session, transcript = linked.get(res)?.transcript ?? false) {
    const id = isSessionId(session || '') ? session : ''
    const now = linked.get(res)
    if (now?.session === id) return
    now?.stop()
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const entry = { session: id, transcript, stop: () => {} }
    linked.set(res, entry)
    if (!id) return send('session', '')
    let told = false
    // A session that has just started has no transcript yet: look again until it does.
    const start = () => {
        const stop = followSession(id, send, { transcript })
        if (stop) return (entry.stop = stop)
        if (!told) {
            send('session', id)
            send('transcript-missing', null)
        }
        told = true
        const timer = setTimeout(start, 2000)
        entry.stop = () => clearTimeout(timer)
    }
    start()
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

/**
 * GET /api/outline/<project>/<file>[/events]: the outline's JSON, or a stream of it, sent again on each change of that
 * file. The stream is the one connection an outline's page holds: it also carries the viewer state, the outline list
 * for the pane (`outlines` events), and the linked session (its messages and activity, and with `?transcript=1` its
 * transcript).
 */
function outlineApi(req, res, parts, url) {
    const [project, file, events] = parts
    if (parts.length > 3 || (events !== undefined && events !== 'events' && events !== 'history' && events !== 'act')) return send(res, 404, 'text/plain', 'not found')
    const outline = readOutline(project, file)
    if (!outline) return send(res, 404, 'text/plain', 'no such outline')
    if (events === 'act') return actApi(req, res, project, file)
    // A node's history: its entries, oldest first (`?num=2.1`).
    if (events === 'history') return send(res, 200, 'application/json', JSON.stringify(history.read(project, file, url.searchParams.get('num') ?? '')))
    const data = JSON.stringify(outline)
    if (!events) return send(res, 200, 'application/json', data)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`retry: 1000\n\ndata: ${data}\n\nevent: state\ndata: ${JSON.stringify(viewerState.read(project, file))}\n\n`)
    res.write(`event: notes\ndata: ${JSON.stringify(agent.messages(project, file))}\n\n`)
    const key = JSON.stringify([project, file])
    if (!outlineStreams.has(key)) outlineStreams.set(key, new Map())
    outlineStreams.get(key).set(res, data)
    const list = outlineList()
    res.write(`event: outlines\ndata: ${list}\n\n`)
    listStreams.set(res, { last: list, event: 'outlines' })
    followLinked(res, outline.session, url.searchParams.get('transcript') === '1')
    req.on('close', () => {
        listStreams.delete(res)
        const streams = outlineStreams.get(key)
        streams?.delete(res)
        if (!streams?.size) outlineStreams.delete(key)
        linked.get(res)?.stop()
        linked.delete(res)
    })
}

/**
 * POST /api/outline/<project>/<file>/act: what the user did on the page, recorded in the outline at once. `set` lists
 * the nodes whose tick changed (`{ num, approved }`); `run` names an action the user pressed play on.
 */
async function actApi(req, res, project, file) {
    if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed')
    if (!fromLocalPage(req, PORT, { write: true }) || !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 403, 'text/plain', 'forbidden')
    try {
        json(res, 200, await agent.act(project, file, await readJson(req)))
    } catch (e) {
        json(res, e instanceof OpError || e instanceof SyntaxError ? 400 : 500, { error: e.message })
    }
}

/**
 * An agent's call: from this machine, to this server by its loopback name, and not from a web page (a page cannot send
 * the header without the server's leave, and sends an Origin).
 */
const fromAgent = req => fromLocalPage(req, PORT, { write: false }) && req.headers['x-outline-agent'] === '1' && !req.headers.origin

/**
 * /api/agent/<tool>: the MCP tools `start`, `read` and `change`, and what the hooks ask for (`pending`, `reload`), each
 * a POST of JSON answered with `{ ok, text }`.
 */
async function agentApi(req, res, name) {
    if (!fromAgent(req)) return send(res, 403, 'text/plain', 'forbidden')
    if (req.method !== 'POST' || !Object.hasOwn(agent, name) || ['act', 'userEvent', 'messages'].includes(name)) return send(res, 404, 'text/plain', 'not found')
    try {
        json(res, 200, agent[name](await readJson(req)))
    } catch (e) {
        console.error(`agent ${name}: ${e.stack || e.message}`)
        json(res, e instanceof SyntaxError ? 400 : 500, { ok: false, text: `The outline server failed: ${e.message}` })
    }
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
        if (text.startsWith(STATUS_KEYS[0]) || /^(\d+(\.\d+)*\.?\s+)?@(user-)?approved\b/i.test(text)) counts.done++
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
            const workspaces = findWorkspaces(config.workspaceDirs)
            refreshWorkspaces(workspaces)
            return json(res, 200, { workspaces, sessions: recentSessions().map(s => ({ ...s, openIn: running.get(s.id) })) })
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
            const terminal = await startSession(request, config)
            pushList()
            return json(res, 200, { terminal })
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
    agent.userEvent(project, file, { kind: 'renamed', title: name })
    return { title: name }
}

/** Delete on an outline's row: moves the outline into <dir>/.trash/<project>/, where it can be moved back by hand. */
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

/** The page (ADR 0001), built into web/dist by `npm install`. */
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

    // The input box's stop button: presses Escape in the outline's tmux session, which stops the agent's turn.
    if (pathname === '/stop' && req.method === 'POST') {
        if (!fromLocalPage(req, PORT, { write: true }) || !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 403, 'text/plain', 'forbidden')
        readJson(req)
            .then(({ terminal }) => {
                stopInTerminal(String(terminal))
                send(res, 200, 'text/plain', 'stopped')
            })
            .catch(e => send(res, 409, 'text/plain', e.message))
        return
    }

    if (pathname.startsWith('/api/agent/')) return agentApi(req, res, pathname.slice('/api/agent/'.length))

    if (pathname.startsWith('/api/outline/')) {
        if (!fromLocalPage(req, PORT, { write: false })) return send(res, 403, 'text/plain', 'forbidden')
        try {
            return outlineApi(req, res, pathname.slice('/api/outline/'.length).split('/'), url)
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

    if (pathname.startsWith('/api/')) return startApi(req, res, pathname, url)

    // Everything else is the app: its files, or its shell for the routes it shows.
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed')
    if (vite) return vite.middlewares(req, res, () => send(res, 404, 'text/plain', 'not found'))
    serveApp(res, pathname)
})

const terminalEnabled = await attachTerminals(server)

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

// A port the parent asked for may be taken (the app keeps its port between launches, and another program can take it
// meanwhile): listen on a free one instead. The settings file's port is the user's choice, so that one fails loudly.
server.on('error', e => {
    if (e.code !== 'EADDRINUSE' || !ASKED_PORT || server.listening) throw e
    console.error(`port ${ASKED_PORT} is taken; listening on a free one`)
    server.listen(0, HOST)
})

server.on('listening', () => {
    PORT = server.address().port
    console.log(`live-discussion-outline on http://localhost:${PORT} watching ${ROOT}`)
    // The parent learns the port from us: as a message in the Outline app's utility process, as a line otherwise.
    if (process.parentPort) process.parentPort.postMessage({ port: PORT })
    else console.log(`port=${PORT}`)
    setTimeout(refreshWorkspaces, 0)
})

server.listen(PORT, HOST)
