import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from './log.js'
import { isSessionId } from './transcript.js'

// Starting a discussion from the page: a new Claude Code session in a tmux session, opened on a workspace, a folder,
// or a past session (resumed), with the outline skill as its first message.

const HOME = os.homedir()
const PROJECTS = path.join(HOME, '.claude', 'projects')
const SKIP_DIRS = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures', 'node_modules'])

const expandHome = p => (p === '~' || p.startsWith('~/') ? path.join(HOME, p.slice(1)) : p)

/** JSON with comments and trailing commas, as editors write workspace files. */
function parseJsonc(text) {
    let out = ''
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === '"') {
            const start = i
            for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
            out += text.slice(start, i + 1)
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++
            out += '\n'
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2)
            if (i < 0) break
            i++
        } else out += c
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function readWorkspace(file) {
    try {
        const dir = path.dirname(file)
        const folders = (parseJsonc(fs.readFileSync(file, 'utf8')).folders || [])
            .filter(f => typeof f.path === 'string')
            .map(f => {
                const full = path.resolve(dir, expandHome(f.path))
                return { name: f.name || path.basename(full), path: full }
            })
            .filter(f => fs.existsSync(f.path))
        return folders.length ? { name: path.basename(file, '.code-workspace'), file, dir, folders } : null
    } catch {
        return null
    }
}

/**
 * Workspace files in each configured folder and its direct subfolders. With none configured, only in the folders recent
 * sessions ran in and their parents (where workspace files usually sit), so the scan never wanders into protected or
 * cloud-synced folders.
 */
export function findWorkspaces(configured) {
    if (!configured.length) {
        const near = new Set(recentSessions(200).flatMap(s => [s.cwd, path.dirname(s.cwd)]))
        near.delete(HOME)
        near.delete(path.dirname(HOME))
        return scanWorkspaces([...near], 0)
    }
    return scanWorkspaces(configured, 1)
}

function scanWorkspaces(dirs, maxDepth) {
    const out = []
    const visit = (dir, depth) => {
        let entries
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const e of entries) {
            if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
            const full = path.join(dir, e.name)
            if (e.isFile() && e.name.endsWith('.code-workspace')) {
                const ws = readWorkspace(full)
                if (ws) out.push(ws)
            } else if (e.isDirectory() && depth > 0) visit(full, depth - 1)
        }
    }
    for (const dir of dirs) visit(expandHome(dir), maxDepth)
    return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The subfolders of `dir`, for the page's folder picker. */
export function listDirs(dir) {
    const full = path.resolve(expandHome(dir || '~'))
    const dirs = fs
        .readdirSync(full, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name, repo: fs.existsSync(path.join(full, e.name, '.git')) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    return { path: full, parent: path.dirname(full), repo: fs.existsSync(path.join(full, '.git')), dirs }
}

const readSlice = (file, start, length) => {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, start)
    fs.closeSync(fd)
    return buf.toString('utf8')
}

const jsonLines = text =>
    text.split('\n').flatMap(line => {
        try {
            return [JSON.parse(line)]
        } catch {
            return []
        }
    })

/** The session's working folder, title and first prompt, from the start and end of its transcript. */
function describeSession(file, size) {
    const head = jsonLines(readSlice(file, 0, Math.min(size, 65536)))
    const tail = size > 65536 ? jsonLines(readSlice(file, Math.max(0, size - 262144), Math.min(size, 262144))) : head
    const cwd = head.find(e => e.cwd)?.cwd
    const titled = [...head, ...tail].filter(e => e.type === 'custom-title' || e.type === 'ai-title')
    const custom = titled.filter(e => e.type === 'custom-title').pop()
    const prompt = head.find(e => e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string' && !e.message.content.startsWith('<'))
    return {
        cwd,
        title: custom?.customTitle || titled.pop()?.aiTitle || prompt?.message.content.split('\n')[0].slice(0, 100) || '(untitled)',
    }
}

const transcriptFiles = () => {
    const out = []
    try {
        for (const dir of fs.readdirSync(PROJECTS)) {
            let names
            try {
                names = fs.readdirSync(path.join(PROJECTS, dir))
            } catch {
                continue
            }
            for (const name of names) {
                if (!name.endsWith('.jsonl') || !isSessionId(name.slice(0, -6))) continue
                const file = path.join(PROJECTS, dir, name)
                const stat = fs.statSync(file)
                out.push({ id: name.slice(0, -6), file, size: stat.size, mtime: stat.mtimeMs })
            }
        }
    } catch {}
    return out
}

/** The folder a session runs in, from its transcript, or undefined. */
export function sessionFolder(id) {
    const t = isSessionId(id) && transcriptFiles().find(f => f.id === id)
    return t ? describeSession(t.file, t.size).cwd : undefined
}

/** Claude Code's most recent sessions, newest first. */
export function recentSessions(limit = 40) {
    return transcriptFiles()
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)
        .map(t => ({ id: t.id, mtime: t.mtime, ...describeSession(t.file, t.size) }))
        .filter(s => s.cwd)
}

/** Which app a claude process belongs to, from its executable path and environment. */
function appOf(args) {
    const pane = (args.match(/\bTMUX_PANE=(%\d+)/) || [])[1]
    if (pane) {
        try {
            const name = execFileSync('tmux', ['display-message', '-p', '-t', pane, '#S'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
            return { app: `tmux session ${name}`, tmux: name }
        } catch {}
    }
    if (args.includes('/.cursor/')) return { app: 'Cursor' }
    if (args.includes('/.vscode/')) return { app: 'VS Code' }
    if (args.includes('Claude.app/') || args.includes('Application Support/Claude/')) return { app: 'the Claude desktop app' }
    return { app: 'another terminal' }
}

/**
 * Claude Code sessions running right now, by session id → `{ pid, app, tmux? }`. A claude process shows its session in
 * `--resume`/`--session-id` arguments, or through the CLAUDE_CODE_SESSION_ID it gives the processes it runs (MCP servers,
 * commands). A session started fresh with nothing running under it is not seen.
 */
export function runningSessions() {
    // `ps -E` appends each process's environment to its command line, so the command alone comes from a plain `ps`.
    const table = env => {
        const rows = new Map()
        const out = execFileSync('ps', ['-axww', ...(env ? ['-E'] : []), '-o', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 64 << 20 })
        for (const line of out.split('\n')) {
            const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
            if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), text: m[3] })
        }
        return rows
    }
    let commands, withEnv
    try {
        commands = table(false)
        withEnv = table(true)
    } catch {
        return new Map()
    }
    const procs = new Map()
    for (const [pid, { ppid, text: command }] of commands) {
        const full = withEnv.get(pid)?.text || command
        const env = full.startsWith(command) ? full.slice(command.length) : ''
        procs.set(pid, { pid, ppid, args: command, env, claude: /(?:^|\/)claude(?= |$)/.test(command) })
    }
    const running = new Map()
    const claim = (id, proc) => {
        if (!running.has(id)) running.set(id, { pid: proc.pid, ...appOf(`${proc.args} ${proc.env}`) })
    }
    for (const p of procs.values()) {
        if (p.claude) {
            const id = (p.args.match(/--(?:resume|session-id)[= ]([0-9a-f]{8}-[0-9a-f-]{27})\b/) || [])[1]
            if (id) claim(id, p)
            // A claude process's own CLAUDE_CODE_SESSION_ID is inherited from whatever started it, so only its children count.
            continue
        }
        const id = (p.env.match(/\bCLAUDE_CODE_SESSION_ID=([0-9a-f]{8}-[0-9a-f-]{27})\b/) || [])[1]
        if (!id) continue
        let parent = procs.get(p.ppid)
        while (parent && !parent.claude) parent = procs.get(parent.ppid)
        // The session's main process: the outermost of the claude processes in a row (helpers are claude processes too).
        while (parent && procs.get(parent.ppid)?.claude) parent = procs.get(parent.ppid)
        if (parent) claim(id, parent)
    }
    return running
}

let claudePath
/** The claude executable: the config's `claudeCommand`, the native install, or whatever the login shell finds. */
function claudeCommand(configured) {
    if (configured) return expandHome(configured)
    if (claudePath) return claudePath
    const native = path.join(HOME, '.local', 'bin', 'claude')
    if (fs.existsSync(native)) return (claudePath = native)
    try {
        const found = execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'command -v claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        claudePath = found.split('\n').filter(l => l.startsWith('/')).pop()
    } catch {}
    return claudePath || 'claude'
}

const hasTmuxSession = name => {
    try {
        execFileSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

const slug = text =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'discussion'

/**
 * Before resuming: a session still open in another app must stop there first, or the two apps write one transcript.
 * Throws (with `openIn`) unless `stopOther` was asked; then ends that claude process and waits for it to exit.
 */
async function freeSession(id, stopOther) {
    const open = runningSessions().get(id)
    if (!open) return
    if (open.tmux) throw Object.assign(new Error(`This session is already running in tmux session ${open.tmux}.`), { openIn: open })
    if (!stopOther) throw Object.assign(new Error(`This session is still open in ${open.app}. Close that chat there first, or stop it from here.`), { openIn: open })
    process.kill(open.pid, 'SIGTERM')
    for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 100))
        if (runningSessions().get(id)?.pid !== open.pid) return
    }
    throw new Error(`The session in ${open.app} did not stop.`)
}

/**
 * Starts `claude` in a new detached tmux session and returns its name. `request` is one of
 * `{ kind: 'workspace', file, topic }`, `{ kind: 'folder', path, topic }` or `{ kind: 'resume', id, stopOther? }`.
 */
export async function startSession(request, { workspaceDirs, claudeCommand: configured }) {
    let cwd, project, label
    const args = ['--permission-mode', 'auto']
    const topic = String(request.topic || '').trim().slice(0, 120)
    if (request.kind === 'workspace') {
        const ws = findWorkspaces(workspaceDirs).find(w => w.file === request.file)
        if (!ws) throw new Error('unknown workspace')
        // The workspace's parent is the working folder; its folders are added so they are the session's listed working folders.
        cwd = ws.dir
        project = ws.name
        label = topic || ws.name
        args.push('--add-dir', ...ws.folders.map(f => f.path))
    } else if (request.kind === 'folder') {
        cwd = path.resolve(expandHome(String(request.path || '')))
        if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`not a folder: ${cwd}`)
        project = path.basename(cwd)
        label = topic || project
    } else if (request.kind === 'resume') {
        const transcript = isSessionId(request.id) && transcriptFiles().find(t => t.id === request.id)
        if (!transcript) throw new Error('unknown session')
        const session = describeSession(transcript.file, transcript.size)
        cwd = session.cwd
        if (!cwd || !fs.existsSync(cwd)) throw new Error(`the session's folder is gone: ${cwd}`)
        await freeSession(request.id, request.stopOther === true)
        label = session.title
        args.push('--resume', request.id)
    } else throw new Error('unknown kind')

    if (topic && request.kind !== 'resume') args.push('--name', topic)
    const prompt = request.kind === 'resume' ? '/live-discussion-outline' : `/live-discussion-outline ${topic}`.trim()

    let name = slug(label)
    for (let i = 2; hasTmuxSession(name); i++) name = `${slug(label).slice(0, 36)}-${i}`
    const env = project ? ['-e', `OUTLINE_PROJECT=${project}`] : []
    // `--` ends claude's options, so the variadic --add-dir does not swallow the prompt.
    execFileSync('tmux', ['new-session', '-d', '-s', name, '-c', cwd, '-x', '160', '-y', '45', ...env, claudeCommand(configured), ...args, '--', prompt])
    // What the outlines pane shows for the session until its outline appears (startedSessions): kept on the tmux
    // session itself, so it outlives a restart of this server and goes away with the session.
    const target = `=${name}:`
    const option = (key, value) => ['set-option', '-t', target, key, String(value).replace(/\s+/g, ' ')]
    try {
        execFileSync('tmux', [...option('@outline-project', project || path.basename(cwd)), ';', ...option('@outline-title', label), ';', ...option('@outline-started', Date.now())], { stdio: 'ignore' })
    } catch {}
    return name
}

/**
 * The tmux sessions "New session" started that are still running, each as `{ terminal, project, title, started }`
 * (started in ms since the epoch), read from what startSession kept on them. None when tmux is not there.
 */
export function startedSessions() {
    let out
    try {
        out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}\t#{@outline-started}\t#{@outline-project}\t#{@outline-title}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
        return []
    }
    return out
        .split('\n')
        .map(line => line.split('\t'))
        .filter(([terminal, started]) => terminal && Number(started) > 0)
        .map(([terminal, started, project, title]) => ({ terminal, project, title: title || project, started: Number(started) }))
}
