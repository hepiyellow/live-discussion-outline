import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { after, before, describe, test } from 'node:test'
import WebSocket from 'ws'
import { freePort, rawGet, startServer } from './helpers.js'

// `--port <n>` is how a parent (the Outline app) says where to listen; the server reports the port it took.

const portOf = url => Number(new URL(url).port)

const hasTmux = (() => {
    try {
        execFileSync('tmux', ['-V'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()

/** Whether a WebSocket upgrade on `url` + `path`, sent as the page at `origin`, is accepted. */
const upgrades = (url, path, origin) =>
    new Promise(resolve => {
        const ws = new WebSocket(url.replace(/^http/, 'ws') + path, { origin })
        ws.on('open', () => (ws.close(), resolve(true)))
        ws.on('error', () => resolve(false))
    })

describe('--port on a free port', () => {
    let server, asked
    before(async () => {
        asked = await freePort()
        server = await startServer({ args: ['--port', String(asked)] })
    })
    after(() => server?.stop())

    test('the server listens there, not on the settings file’s port', async () => {
        assert.equal(portOf(server.url), asked)
        assert.notEqual(asked, server.settingsPort)
        assert.equal((await fetch(`${server.url}/api/outline/demo/sample`)).status, 200)
        await assert.rejects(fetch(`http://127.0.0.1:${server.settingsPort}/api/outline/demo/sample`))
    })
})

describe('--port 0', () => {
    let server
    before(async () => (server = await startServer({ args: ['--port', '0'] })))
    after(() => server?.stop())

    test('the server picks a free port and reports it', async () => {
        assert.ok(portOf(server.url) > 0)
        assert.equal((await fetch(`${server.url}/api/outline/demo/sample`)).status, 200)
    })
})

describe('--port on a taken port', () => {
    let server, holder, taken, scratch, tmuxEnv
    const old = () => `http://127.0.0.1:${taken}`
    const patch = origin =>
        fetch(`${server.url}/api/state/demo/sample`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin }, body: '{}' })
    before(async () => {
        holder = net.createServer()
        await new Promise((resolve, reject) => holder.on('error', reject).listen(0, '127.0.0.1', resolve))
        taken = holder.address().port
        // The server's tmux is one of our own (TMUX_TMPDIR), on a short path: a tmux socket's path is limited.
        scratch = fs.mkdtempSync('/tmp/ldo-port-')
        tmuxEnv = { TMUX: '', TMUX_TMPDIR: scratch }
        server = await startServer({ args: ['--port', String(taken)], env: tmuxEnv })
    })
    after(async () => {
        await server?.stop()
        if (hasTmux)
            try {
                execFileSync('tmux', ['kill-server'], { env: { ...process.env, ...tmuxEnv }, stdio: 'ignore' })
            } catch {}
        holder?.close()
        fs.rmSync(scratch, { recursive: true, force: true })
    })

    test('the server reports another port and answers there', async () => {
        assert.notEqual(portOf(server.url), taken)
        const res = await fetch(`${server.url}/api/outline/demo/sample`)
        assert.equal(res.status, 200)
        assert.equal((await res.json()).title, 'Caching for the search service')
    })

    test('a write is accepted from the page on that port, and refused from the taken one', async () => {
        assert.equal((await patch(server.url)).status, 200)
        assert.equal((await patch(`http://localhost:${portOf(server.url)}`)).status, 200)
        assert.equal((await patch(old())).status, 403)
    })

    test('a read addressed to the taken port is refused', async () => {
        assert.equal((await rawGet(server.url, '/api/outline/demo/sample', { host: `127.0.0.1:${taken}` })).status, 403)
        assert.equal((await rawGet(server.url, '/api/outline/demo/sample', { host: `127.0.0.1:${portOf(server.url)}` })).status, 200)
    })

    test('the terminal is reached from the page on that port only', { skip: !hasTmux && 'no tmux' }, async t => {
        const outline = await (await fetch(`${server.url}/api/outline/demo/sample`)).json()
        if (!outline.terminalTab) return t.skip('no terminal tab')
        execFileSync('tmux', ['new-session', '-d', '-s', 'ldo-port', 'sleep 600'], { env: { ...process.env, ...tmuxEnv }, stdio: 'ignore' })
        assert.equal(await upgrades(server.url, '/term?s=ldo-port', old()), false)
        assert.equal(await upgrades(server.url, '/term?s=ldo-port', server.url), true)
    })
})

describe('--port with no number', () => {
    test('the server refuses to start', async () => {
        await assert.rejects(startServer({ args: ['--port', 'abc'] }), /--port takes a port number/)
    })
})
