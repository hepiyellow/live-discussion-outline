import { execFileSync as run } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { format } from 'node:util'
import { monitorEventLoopDelay } from 'node:perf_hooks'

// The server's own log. Its terminal is not always there to read, so everything the server prints also lands here.
export const LOG_FILE = path.join(os.homedir(), '.config', 'live-discussion-outline', 'server.log')

// A tmux or ps that hangs would otherwise block the one thread the server runs on, for good.
const COMMAND_TIMEOUT = 5000

function write(level, message) {
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level} pid=${process.pid} ${message}\n`)
    } catch {}
}

/** Runs a command synchronously. A timeout is logged with the command, then thrown as before. */
export function execFileSync(file, args, options = {}) {
    const started = Date.now()
    try {
        return run(file, args, { timeout: COMMAND_TIMEOUT, ...options })
    } catch (e) {
        if (e.code === 'ETIMEDOUT' || e.signal) write('error', `${file} ${args.slice(0, 2).join(' ')} did not finish after ${Date.now() - started} ms (${e.signal || e.code})`)
        throw e
    }
}

/** Mirrors console output into the log file, records crashes, and reports event-loop stalls. Call once at startup. */
export function installLogging() {
    const info = console.log
    const error = console.error
    console.log = (...args) => {
        info(...args)
        write('info', format(...args))
    }
    console.error = (...args) => {
        error(...args)
        write('error', format(...args))
    }
    process.on('uncaughtException', e => {
        write('fatal', `uncaught exception: ${e?.stack || e}`)
        process.exit(1)
    })
    process.on('unhandledRejection', e => write('error', `unhandled rejection: ${e?.stack || e}`))
    // A synchronous call that blocks the server shows up here once it returns, with how long it blocked.
    const delay = monitorEventLoopDelay({ resolution: 20 })
    delay.enable()
    setInterval(() => {
        const ms = delay.max / 1e6
        if (ms > 1000) write('warn', `event loop blocked for ${Math.round(ms)} ms`)
        delay.reset()
    }, 5000).unref()
    write('info', `started, logging to ${LOG_FILE}`)
}
