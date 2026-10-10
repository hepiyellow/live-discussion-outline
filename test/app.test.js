import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import WebSocket from 'ws'
import { ROOT, rawGet, startServer } from './helpers.js'

/** Whether a WebSocket upgrade on `path` with `protocol` is accepted. */
const upgrades = (url, path, protocol) =>
    new Promise(resolve => {
        const ws = new WebSocket(url.replace(/^http/, 'ws') + path, protocol, { origin: url })
        ws.on('open', () => (ws.close(), resolve(true)))
        ws.on('error', () => resolve(false))
    })

describe('the app', () => {
    let server
    before(async () => {
        // `npm install` builds it; build it here only when a checkout has not.
        if (!fs.existsSync(path.join(ROOT, 'web/dist/index.html'))) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' })
        server = await startServer()
    })
    after(() => server?.stop())

    for (const route of ['/', '/demo/sample', '/live?t=ldo-new']) {
        test(`${route} serves the app shell`, async () => {
            const res = await fetch(server.url + route)
            assert.equal(res.status, 200)
            assert.match(res.headers.get('content-type'), /^text\/html/)
            assert.match(await res.text(), /<div id="root"><\/div>/)
        })
    }

    test('the shell’s script and stylesheet are served', async () => {
        const html = await (await fetch(`${server.url}/`)).text()
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])
        assert.ok(assets.length >= 2)
        for (const a of assets) {
            const res = await fetch(server.url + a)
            assert.equal(res.status, 200, a)
            assert.match(res.headers.get('content-type'), a.endsWith('.js') ? /^text\/javascript/ : /^text\/css/)
            assert.match(res.headers.get('cache-control'), /immutable/)
        }
    })

    test('the app’s former paths under /app/ redirect', async () => {
        for (const [from, to] of [
            ['/app', '/'],
            ['/app/', '/'],
            ['/app/demo/sample', '/demo/sample'],
            ['/app/live?t=ldo-new', '/live?t=ldo-new'],
        ]) {
            const res = await fetch(server.url + from, { redirect: 'manual' })
            assert.equal(res.status, 301, from)
            assert.equal(res.headers.get('location'), to, from)
        }
    })

    test('a missing asset is a 404, not the shell', async () => {
        assert.equal((await fetch(`${server.url}/assets/missing.js`)).status, 404)
    })

    test('nothing outside the build is served', async () => {
        for (const path of ['/..%2Fserver.js', '/assets/..%2F..%2F..%2Fpackage.json', '/%2E%2E/%2E%2E/package.json']) {
            const { body } = await rawGet(server.url, path)
            assert.doesNotMatch(body, /createServer|"devDependencies"/, path)
        }
    })

    test('WebSockets other than the terminal are closed', async () => {
        assert.equal(await upgrades(server.url, '/', 'vite-hmr'), false)
        assert.equal(await upgrades(server.url, '/term?s=no-such-session'), false)
    })
})

describe('the app with --dev', () => {
    let server
    before(async () => (server = await startServer({ args: ['--dev'] })))
    after(() => server?.stop())

    test('Vite serves /demo/sample from the sources, with hot reload', async () => {
        const res = await fetch(`${server.url}/demo/sample`, { headers: { accept: 'text/html' } })
        assert.equal(res.status, 200)
        const html = await res.text()
        assert.match(html, /<div id="root"><\/div>/)
        assert.match(html, /\/@vite\/client/)
        assert.match(html, /\/src\/main\.tsx/)
    })

    test('the hot reload WebSocket connects', async () => {
        // The page's Vite client carries the token that Vite asks of a WebSocket from a page.
        const client = await (await fetch(`${server.url}/@vite/client`)).text()
        const token = client.match(/const wsToken = "([^"]+)"/)?.[1]
        assert.ok(token)
        assert.equal(await upgrades(server.url, `/?token=${token}`, 'vite-hmr'), true)
        assert.equal(await upgrades(server.url, '/elsewhere', 'other'), false)
        assert.equal(await upgrades(server.url, `/elsewhere?token=${token}`, 'vite-hmr'), false)
    })

    test('the app’s modules are compiled on request', async () => {
        const res = await fetch(`${server.url}/src/App.tsx`)
        assert.equal(res.status, 200)
        assert.match(await res.text(), /export function App/)
    })
})
