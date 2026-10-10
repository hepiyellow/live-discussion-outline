import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fallbackPath, loginShellPath, parseShellPath } from '../app/path.js'
import { superviseServer, tailOf } from '../app/supervisor.js'

// The Outline app's own logic, in modules that load without Electron (app/main.js wires them to it).

describe('the PATH from the login shell', () => {
    let scratch
    /** A stand-in for the user's shell: an executable script, run as `<shell> -ilc <command>`. */
    const shell = (name, script) => {
        const file = path.join(scratch, name)
        fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
        return file
    }
    before(() => (scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-shell-'))))
    after(() => fs.rmSync(scratch, { recursive: true, force: true }))

    test('is found between what the shell’s startup files print', () => {
        assert.equal(parseShellPath('Last login: today\n__LDO_PATH__/opt/homebrew/bin:/usr/bin__LDO_PATH__\n% '), '/opt/homebrew/bin:/usr/bin')
        assert.equal(parseShellPath('no marks here'), '')
        assert.equal(parseShellPath('__LDO_PATH____LDO_PATH__'), '')
    })

    test('the fallback adds Homebrew’s folders once', () => {
        assert.equal(fallbackPath('/usr/bin:/bin'), '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin')
        assert.equal(fallbackPath('/usr/local/bin:/usr/bin'), '/usr/local/bin:/usr/bin:/opt/homebrew/bin')
        assert.equal(fallbackPath(), '/opt/homebrew/bin:/usr/local/bin')
    })

    test('is what the shell has after its startup files ran', async () => {
        // The startup files print a banner and set PATH; then the shell runs the command it was given.
        const zsh = shell('zsh', 'echo "Welcome back"\nPATH=/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin\nexport PATH\n[ "$1" = -ilc ] && eval "$2"')
        assert.equal(await loginShellPath({ shell: zsh, env: { PATH: '/usr/bin:/bin' } }), '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin')
    })

    test('a shell that does not answer in time gives the fallback', async () => {
        const stuck = shell('stuck', 'sleep 30')
        const started = Date.now()
        assert.equal(await loginShellPath({ shell: stuck, env: { PATH: '/usr/bin:/bin' }, timeout: 200 }), '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin')
        assert.ok(Date.now() - started < 5000)
    })

    test('a shell that fails, prints nothing, or is missing gives the fallback', async () => {
        const fallback = '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'
        const env = { PATH: '/usr/bin:/bin' }
        assert.equal(await loginShellPath({ shell: shell('failing', 'exit 3'), env }), fallback)
        assert.equal(await loginShellPath({ shell: shell('silent', 'echo hello'), env }), fallback)
        assert.equal(await loginShellPath({ shell: path.join(scratch, 'no-such-shell'), env }), fallback)
    })
})

describe('the app’s server', () => {
    /** Stand-ins for the server's processes, in the order they were started. */
    function harness(port) {
        const started = []
        const listening = []
        let gaveUp = 0
        let clock = 0
        const fork = args => {
            const child = Object.assign(new EventEmitter(), { args, killed: false, kill: () => (child.killed = true) })
            started.push(child)
            return child
        }
        const server = superviseServer({ fork, port, onListening: p => listening.push(p), onGaveUp: () => gaveUp++, now: () => clock })
        return { server, started, listening, gaveUp: () => gaveUp, wait: ms => (clock += ms) }
    }

    test('starts on the port it is given, and on any free one without', () => {
        assert.deepEqual(harness(51234).started[0].args, ['--port', '51234'])
        assert.deepEqual(harness().started[0].args, ['--port', '0'])
    })

    test('says which port the server listens on', () => {
        const h = harness(0)
        h.started[0].emit('message', { port: 51234 })
        assert.deepEqual(h.listening, [51234])
        assert.equal(h.server.port(), 51234)
        h.started[0].emit('message', 'something else')
        assert.deepEqual(h.listening, [51234])
    })

    test('a server that dies is started again once, on the port it had', () => {
        const h = harness(0)
        h.started[0].emit('message', { port: 51234 })
        h.started[0].emit('exit', 1)
        assert.equal(h.started.length, 2)
        assert.deepEqual(h.started[1].args, ['--port', '51234'])
        assert.equal(h.gaveUp(), 0)
        h.wait(5000)
        h.started[1].emit('exit', 1)
        assert.equal(h.started.length, 2)
        assert.equal(h.gaveUp(), 1)
    })

    test('a server that ran for a while before dying again is started again', () => {
        const h = harness(51234)
        h.started[0].emit('exit', 1)
        h.wait(10 * 60_000)
        h.started[1].emit('exit', 1)
        assert.equal(h.started.length, 3)
        assert.equal(h.gaveUp(), 0)
    })

    test('after giving up, it can be started again', () => {
        const h = harness(51234)
        h.started[0].emit('exit', 1)
        h.started[1].emit('exit', 1)
        assert.equal(h.gaveUp(), 1)
        h.server.start()
        assert.equal(h.started.length, 3)
        h.started[2].emit('message', { port: 51234 })
        assert.deepEqual(h.listening, [51234])
    })

    test('stopping ends the server and does not start it again', () => {
        const h = harness(51234)
        h.server.stop()
        assert.equal(h.started[0].killed, true)
        h.started[0].emit('exit', 0)
        assert.equal(h.started.length, 1)
        assert.equal(h.gaveUp(), 0)
    })

    test('the end of the log is its last lines', () => {
        const file = path.join(os.tmpdir(), `ldo-log-${process.pid}.log`)
        fs.writeFileSync(file, Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
        try {
            assert.equal(tailOf(file, 3), 'line 38\nline 39\nline 40')
            assert.equal(tailOf(`${file}.missing`), '')
        } finally {
            fs.rmSync(file)
        }
    })
})
