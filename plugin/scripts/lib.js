// Shared by the MCP process, the hooks and the file-mode skill's start script: finding the outline server and calling it. Node's own modules only, since
// an installed plugin is a copy of this folder without the checkout's node_modules.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The settings file (config.js): where the server listens and keeps outlines, and where its checkout is when this plugin is a copy. */
export function settings() {
    try {
        const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'outline-only', 'config.json'), 'utf8'))
        return value && typeof value === 'object' ? value : {}
    } catch {
        return {}
    }
}

function request(port, method, pathname, body, timeout) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body)
        const req = http.request(
            { host: '127.0.0.1', port, method, path: pathname, timeout, headers: { host: `127.0.0.1:${port}`, 'x-outline-agent': '1', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } },
            res => {
                let text = ''
                res.setEncoding('utf8')
                res.on('data', chunk => (text += chunk))
                res.on('end', () => resolve({ status: res.statusCode, text }))
            },
        )
        req.on('timeout', () => req.destroy(new Error('the outline server did not answer in time')))
        req.on('error', reject)
        req.end(data)
    })
}

const alive = port => request(port, 'GET', '/health', undefined, 500).then(r => r.status === 200 && r.text === 'ok', () => false)

/** The checkout whose server.js to start: the one this file is part of, else the one the settings file names. */
function checkout() {
    const here = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '..', '..')
    for (const dir of [here, settings().checkout]) if (dir && fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'model.js'))) return dir
    return ''
}

/**
 * The port of a running outline server: the Outline app's, else `npm start`'s. With `start`, a server that is not
 * running is started in the background, as the skill's ensure step did. Returns 0 when there is none.
 */
export async function findServer({ start = false } = {}) {
    const { appPort, port } = settings()
    const own = Number(port) || 4577
    // For trying a server that is not the settings file's (a second checkout): the agent's own environment names its port.
    const asked = Number(process.env.OUTLINE_PORT) || 0
    if (asked) return (await alive(asked)) ? asked : 0
    for (const p of [Number(appPort) || 0, own]) if (p && (await alive(p))) return p
    if (!start) return 0
    const root = checkout()
    if (!root) return 0
    const log = fs.openSync(path.join(os.tmpdir(), 'outline-only.log'), 'a')
    // tmux refuses to attach from a server that thinks it is inside tmux (terminal.js): it does not need to know.
    const env = { ...process.env }
    spawn(process.execPath, [path.join(root, 'server.js')], { detached: true, stdio: ['ignore', log, log], env, cwd: root }).unref()
    for (let i = 0; i < 40; i++) {
        if (await alive(own)) return own
        await new Promise(r => setTimeout(r, 250))
    }
    return 0
}

/** The outlines folder, as config.js works it out: the settings file's `dir`, else the default. */
export function outlinesDir() {
    const dir = settings().dir || '~/outlines'
    return path.resolve(dir === '~' || dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(1)) : dir)
}

/**
 * Who writes an outline, from its text, as outline.js reads its header lines: `server` when a `Mode: server` line is
 * among them, else `file`.
 */
export function modeOf(text) {
    const lines = text.split('\n')
    for (const label of ['Title', 'Resume', 'Model', 'Terminal', 'Session', 'Mode']) {
        const i = lines.slice(0, 8).findIndex(line => line.startsWith(`${label}: `))
        if (i < 0) continue
        const [line] = lines.splice(i, 1)
        if (label === 'Mode') return line.slice(6).trim().replace(/^`+|`+$/g, '') === 'server' ? 'server' : 'file'
    }
    return 'file'
}

/** Calls /api/agent/<name> and returns its `{ ok, text, … }`. */
export async function call(port, name, body, timeout = 15000) {
    const res = await request(port, 'POST', `/api/agent/${name}`, body, timeout)
    // A server from before the agent's API answers its page here.
    if (res.status === 404 || (res.status === 200 && !res.text.startsWith('{')))
        return { ok: false, text: `The outline server on port ${port} is an older version that cannot take changes from an agent. Ask the user to restart it (the Outline Only app, or \`npm start\`) from the current checkout.` }
    try {
        return JSON.parse(res.text)
    } catch {
        return { ok: false, text: `The outline server answered ${res.status}: ${res.text.slice(0, 200)}` }
    }
}

/** The tmux session this process runs in (inherited from the agent), or empty outside tmux. */
export function tmuxSession() {
    if (!process.env.TMUX) return ''
    try {
        return execFileSync('tmux', ['display-message', '-p', '#S'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
        return ''
    }
}
