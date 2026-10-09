import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

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
 * the user's settings file nor their outlines. Call `stop()` when done.
 */
export async function startServer({ args = [] } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-test-'))
    const dir = path.join(home, 'outlines')
    fs.mkdirSync(dir)
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
    return { url, dir, home, stop }
}
