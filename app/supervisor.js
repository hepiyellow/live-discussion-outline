import fs from 'node:fs'

// The Outline app owns the server: it starts it, starts it again when it dies, and stops it on quitting.

/** A server that dies again this soon after being started again is not started a third time. */
const SETTLED_MS = 60_000

/**
 * Runs the server and keeps it running. `fork(args)` starts server.js with those arguments and returns its process:
 * it emits `message` (the server's `{ port }` once it listens) and `exit`, and has `kill()`.
 *
 * `onListening(port)` is called each time the server listens. A server that dies is started again once, on the port it
 * had; if that one dies too before it has run for a minute, `onGaveUp()` is called, and `start()` tries again.
 * `stop()` then `start()` is for a change of settings, and does not count as dying.
 */
export function superviseServer({ fork, port = 0, onListening, onGaveUp, now = Date.now }) {
    let child
    let alive = false
    let restartedAt = -Infinity
    let stopped = false

    function start() {
        stopped = false
        alive = true
        const mine = (child = fork(['--port', String(port)]))
        mine.on('message', message => {
            if (mine !== child || !Number.isInteger(message?.port)) return
            // From here on the server is started on the port it took, so the window's address stays good.
            port = message.port
            onListening(port)
        })
        mine.once('exit', () => {
            if (mine !== child) return
            alive = false
            if (stopped) return
            if (now() - restartedAt < SETTLED_MS) return onGaveUp()
            restartedAt = now()
            start()
        })
    }

    /** Ends the server, and does not start it again. Resolves once its process is gone, so its port is free. */
    function stop() {
        stopped = true
        if (!alive) return Promise.resolve()
        const mine = child
        return new Promise(resolve => {
            mine.once('exit', () => resolve())
            mine.kill()
        })
    }

    start()
    return { start, stop, port: () => port }
}

/** The last `lines` lines of a text file, or empty when it cannot be read. */
export function tailOf(file, lines = 15) {
    try {
        return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
    } catch {
        return ''
    }
}
