import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURES = path.join(ROOT, 'test', 'fixtures')
/** The session id of the fixture transcript, which sample.md links to. */
export const SESSION = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f'

const freePort = () =>
    new Promise((resolve, reject) => {
        const probe = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = probe.address()
            probe.close(() => resolve(port))
        })
        probe.on('error', reject)
    })

/**
 * Starts the server on a free port, with `HOME` and the outlines folder in a new temporary folder, so it reads neither
 * the user's settings file nor their outlines. The folder gets a copy of the fixtures: test/fixtures/outlines as the
 * outlines folder, and the transcripts where Claude Code keeps them (~/.claude/projects/<folder>/<session id>.jsonl).
 * Call `stop()` when done.
 */
export async function startServer({ args = [] } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-test-'))
    const dir = path.join(home, 'outlines')
    fs.cpSync(path.join(FIXTURES, 'outlines'), dir, { recursive: true })
    fs.cpSync(path.join(FIXTURES, 'transcripts'), path.join(home, '.claude', 'projects', '-home-dev-search'), { recursive: true })
    const port = await freePort()
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), ...args], {
        cwd: ROOT,
        env: { ...process.env, HOME: home, OUTLINE_DIR: dir, OUTLINE_PORT: String(port), OUTLINE_HOST: '127.0.0.1', OUTLINE_CONFIG: path.join(home, 'none.json') },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', d => (log += d))
    child.stderr.on('data', d => (log += d))
    const url = `http://127.0.0.1:${port}`
    const stop = async () => {
        if (child.exitCode === null) {
            child.kill()
            await new Promise(r => child.once('exit', r))
        }
        fs.rmSync(home, { recursive: true, force: true })
    }
    for (const deadline = Date.now() + 20000; ; ) {
        if (child.exitCode !== null) {
            await stop()
            throw new Error(`server exited:\n${log}`)
        }
        try {
            if ((await fetch(`${url}/health`)).ok) break
        } catch {}
        if (Date.now() > deadline) {
            await stop()
            throw new Error(`server did not start:\n${log}`)
        }
        await new Promise(r => setTimeout(r, 100))
    }
    /** Replaces outline <project>/<file> with a fixture outline, the way the agent rewrites it. */
    const swap = (target, fixture) => fs.copyFileSync(path.join(FIXTURES, 'outlines', `${fixture}.md`), path.join(dir, `${target}.md`))
    return { url, dir, home, stop, swap }
}

/**
 * The events of a server-sent event stream, as an async iterator of `{ event, data }`; `close()` ends it. Only for
 * tests: it assumes a well-formed stream.
 */
export async function eventStream(url) {
    const controller = new AbortController()
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    const queue = []
    const next = async () => {
        while (!queue.length) {
            const { value, done } = await reader.read()
            if (done) return null
            buffer += value
            let end
            while ((end = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, end)
                buffer = buffer.slice(end + 2)
                const event = { event: 'message', data: [] }
                for (const line of block.split('\n')) {
                    const i = line.indexOf(':')
                    const field = i < 0 ? line : line.slice(0, i)
                    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
                    if (field === 'event') event.event = value
                    else if (field === 'data') event.data.push(value)
                }
                if (block.split('\n').some(l => l.startsWith('data') || l.startsWith('event'))) queue.push({ event: event.event, data: event.data.join('\n') })
            }
        }
        return queue.shift()
    }
    /** The next event, or a rejection after `ms`. */
    const take = (ms = 5000) =>
        Promise.race([next(), new Promise((_, reject) => setTimeout(() => reject(new Error(`no event from ${url} within ${ms} ms`)), ms))])
    return { take, close: () => controller.abort() }
}

/** A GET sent as written, with the given headers: fetch() resolves `..` segments and will not send its own Host. */
export const rawGet = (url, path, headers = {}) =>
    new Promise((resolve, reject) => {
        http.get(url + path, { headers }, res => {
            let body = ''
            res.on('data', d => (body += d))
            res.on('end', () => resolve({ status: res.statusCode, body }))
        }).on('error', reject)
    })
