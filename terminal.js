import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

// The Terminal tab: a WebSocket on /term?s=<tmux session> attaches a tmux client in a pty and pipes it to xterm.js in the page.

const SESSION_RE = /^[A-Za-z0-9_.-]{1,64}$/
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export const isSessionName = name => SESSION_RE.test(name)

export const hasSession = name => {
    try {
        execFileSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

/**
 * Requests that read a session or type into it must come from this machine's own page: a loopback peer and a loopback
 * Host (no DNS rebinding). Writes also need our page as Origin; a same-origin EventSource GET sends no Origin, so reads skip that.
 */
export function fromLocalPage(req, port, { write }) {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return false
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    return hosts.includes(req.headers.host) && (!write || hosts.some(h => req.headers.origin === `http://${h}`))
}

/** Types `text` into the session's active pane as one bracketed paste, then presses Enter, as if typed there. */
export async function sendToTerminal(name, text) {
    if (!isSessionName(name) || !hasSession(name)) throw new Error(`no tmux session ${name}`)
    // `=name:` is the session's active pane (a bare `=name` only names a session).
    const pane = `=${name}:`
    execFileSync('tmux', ['set-buffer', '-b', 'ldo-send', '--', text])
    execFileSync('tmux', ['paste-buffer', '-p', '-d', '-b', 'ldo-send', '-t', pane])
    // Give the agent's UI a moment to take the paste before Enter submits it.
    await new Promise(r => setTimeout(r, 150))
    execFileSync('tmux', ['send-keys', '-t', pane, 'Enter'])
}

/** npm unpacks node-pty's prebuilt spawn-helper without its execute bit on macOS, and every spawn then fails. */
function fixSpawnHelper(require) {
    const helper = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    try {
        if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755)
    } catch (e) {
        console.error(`could not make ${helper} executable: ${e.message}`)
    }
}

const size = (v, fallback) => Math.min(500, Math.max(10, Number(v) || fallback))

function bridge(pty, ws, name, url) {
    const env = { ...process.env, TERM: 'xterm-256color' }
    // ensure.js may have started this server from inside tmux; tmux refuses to attach from a nested client.
    delete env.TMUX
    delete env.TMUX_PANE
    // Without mouse mode tmux drops the wheel and clicks the agent's full-screen UI uses.
    try {
        execFileSync('tmux', ['set-option', '-t', `=${name}`, 'mouse', 'on'], { stdio: 'ignore' })
    } catch {}
    const term = pty.spawn('tmux', ['attach-session', '-t', `=${name}`], {
        name: 'xterm-256color',
        cols: size(url.searchParams.get('cols'), 100),
        rows: size(url.searchParams.get('rows'), 30),
        cwd: os.homedir(),
        env,
    })
    term.onData(data => {
        if (ws.readyState === ws.OPEN) ws.send(data)
    })
    term.onExit(() => ws.close())
    ws.on('message', raw => {
        let msg
        try {
            msg = JSON.parse(raw)
        } catch {
            return
        }
        if (msg.t === 'i' && typeof msg.d === 'string') term.write(msg.d)
        else if (msg.t === 'r') term.resize(size(msg.c, 100), size(msg.r, 30))
    })
    // Killing the client only detaches it; the session keeps running.
    ws.on('close', () => term.kill())
}

/** Adds the /term WebSocket to the server. Without node-pty or ws installed the Terminal tab is just unavailable. */
export async function attachTerminals(server, port) {
    let pty, WebSocketServer
    try {
        pty = (await import('node-pty')).default
        ;({ WebSocketServer } = await import('ws'))
    } catch (e) {
        console.error(`terminal tab disabled: ${e.message}`)
        return false
    }
    fixSpawnHelper(createRequire(import.meta.url))
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://localhost')
        const name = url.searchParams.get('s') || ''
        if (url.pathname !== '/term' || !fromLocalPage(req, port, { write: true }) || !isSessionName(name) || !hasSession(name)) return socket.destroy()
        wss.handleUpgrade(req, socket, head, ws => bridge(pty, ws, name, url))
    })
    return true
}
