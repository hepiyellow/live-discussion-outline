import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ROOT, SESSION, startServer, until } from './helpers.js'
import { ASK_MS, EFFORT_QUESTION, TAKEN_MS, createSwitches, switchOf } from '../switching.js'

// The model and effort switches the page asks for: Claude Code's own question about one is answered for the user.

describe('switches asked from the page', () => {
    /** Switches over a terminal that records what is typed, shows `screen.question` or not, and counts the answers. */
    const make = () => {
        const typed = []
        const screen = { question: false, answers: 0 }
        let time = 1_000_000
        const switches = createSwitches({
            type: async (terminal, text) => typed.push([terminal, text]),
            answer: (terminal, parts) => {
                assert.deepEqual(parts, EFFORT_QUESTION)
                if (!screen.question) return false
                screen.question = false
                screen.answers++
                return true
            },
            now: () => time,
            pause: 5,
            tries: 4,
        })
        return { switches, typed, screen, later: ms => (time += ms) }
    }

    test('a line is a switch only when it is /model or /effort with one value', () => {
        assert.deepEqual(switchOf('/model claude-opus-5-5'), { kind: 'model', value: 'claude-opus-5-5' })
        assert.deepEqual(switchOf(' /effort low\n'), { kind: 'effort', value: 'low' })
        for (const text of ['/model', 'use /model claude-opus-5-5', '/model a b', '/rename x', 'hello']) assert.equal(switchOf(text), null, text)
    })

    test('a model switch is the page’s from when it was asked until a little after Claude Code first asks', async () => {
        const { switches, typed, later } = make()
        assert.equal(switches.asked('t1'), false)
        await switches.typeInto('t1', 'hello')
        assert.equal(switches.asked('t1'), false)
        await switches.typeInto('t1', '/model claude-sonnet-5-5')
        assert.deepEqual(typed, [['t1', 'hello'], ['t1', '/model claude-sonnet-5-5']])
        // Another session's switch is not this one's.
        assert.equal(switches.asked('t2'), false)
        // The command ran only when a long turn ended: still the page's. One switch runs its hook more than once.
        later(20 * 60_000)
        assert.equal(switches.asked('t1'), true)
        later(TAKEN_MS - 1)
        assert.equal(switches.asked('t1'), true)
        // A switch typed in the terminal later is not.
        later(2)
        assert.equal(switches.asked('t1'), false)
        assert.equal(switches.asked('t1'), false)
    })

    test('a model switch Claude Code never got to is forgotten', async () => {
        const { switches, later } = make()
        await switches.typeInto('t1', '/model claude-sonnet-5-5')
        later(ASK_MS + 1)
        assert.equal(switches.asked('t1'), false)
    })

    test('the effort question is answered when it comes up after the command', async () => {
        const { switches, screen } = make()
        await switches.typeInto('t1', '/effort low')
        assert.equal(screen.answers, 0)
        screen.question = true
        await until(() => screen.answers === 1, { what: 'the effort question to be answered' })
    })

    test('an effort question that came up late is answered before the next line is typed', async () => {
        const { switches, typed, screen } = make()
        await switches.typeInto('t1', '/effort low')
        // The command ran only when the turn ended, after the watch for its question was over.
        await new Promise(r => setTimeout(r, 60))
        screen.question = true
        await switches.typeInto('t1', 'my message')
        assert.equal(screen.answers, 1)
        assert.deepEqual(typed.at(-1), ['t1', 'my message'])
        // Answered once: the next line looks at nothing.
        screen.question = true
        await switches.typeInto('t1', 'another')
        assert.equal(screen.answers, 1)
    })

    test('a line typed into a session nobody asked an effort change of looks at no screen', async () => {
        const { switches, screen } = make()
        screen.question = true
        await switches.typeInto('t1', 'hello')
        await switches.typeInto('t1', '/model claude-sonnet-5-5')
        assert.equal(screen.answers, 0)
    })
})

const hasTmux = (() => {
    try {
        execFileSync('tmux', ['-V'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()

// With a real terminal: the test runs its own tmux server (TMUX_TMPDIR), never the user's.
describe('a switch typed into a session terminal', { skip: !hasTmux && 'no tmux' }, () => {
    let server, scratch, tmuxEnv
    const tmux = (...args) => execFileSync('tmux', args, { env: { ...process.env, ...tmuxEnv }, stdio: 'ignore' })
    /** POST /send as the page does. */
    const send = (terminal, text) => fetch(`${server.url}/send`, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.url }, body: JSON.stringify({ terminal, text }) })
    /** The plugin's PreModelSwitch hook, as Claude Code runs it: what it prints. */
    const hook = event =>
        new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(ROOT, 'plugin', 'scripts', 'outline-hook.js')], { env: { ...process.env, HOME: server.home, OUTLINE_PORT: new URL(server.url).port }, stdio: ['pipe', 'pipe', 'inherit'] })
            let out = ''
            child.stdout.on('data', d => (out += d))
            child.on('error', reject)
            child.on('exit', () => resolve(out.trim()))
            child.stdin.end(JSON.stringify({ hook_event_name: 'PreModelSwitch', session_id: SESSION, cwd: '/home/dev/search', from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'claude-sonnet-5-5', source: 'command', ...event }))
        })
    before(async () => {
        // A short path: a tmux socket's path is limited to about 100 characters.
        scratch = fs.mkdtempSync('/tmp/outline-only-switch-')
        tmuxEnv = { TMUX: '', TMUX_TMPDIR: scratch }
        server = await startServer({ env: tmuxEnv })
        server.swap('demo/sample', 'demo/sample', 'server')
    })
    after(async () => {
        await server?.stop()
        try {
            tmux('kill-server')
        } catch {}
        fs.rmSync(scratch, { recursive: true, force: true })
    })

    test('the hook lets a model switch asked from the page through, and no other', async () => {
        // The outline's session terminal (sample.md's Terminal: line), with a stand-in for the agent.
        tmux('new-session', '-d', '-s', 'outline-only-sample', 'cat')
        assert.equal(await hook(), '')
        assert.equal((await send('outline-only-sample', 'hello')).status, 200)
        assert.equal(await hook(), '')
        assert.equal((await send('outline-only-sample', '/model claude-sonnet-5-5')).status, 200)
        assert.deepEqual(JSON.parse(await hook()), { hookSpecificOutput: { hookEventName: 'PreModelSwitch', permissionDecision: 'allow' } })
        // A session that has no outline is not the page's to answer for.
        assert.equal(await hook({ session_id: '11111111-2222-4333-8444-555555555555', cwd: '/nowhere' }), '')
    })

    test('the effort question on the session’s screen is answered yes, and a message after it arrives', async () => {
        // A stand-in for Claude Code: after a command it asks, and takes Enter as yes; then it reads the next line.
        const agent = path.join(scratch, 'agent.sh')
        const log = path.join(scratch, 'agent.log')
        fs.writeFileSync(agent, `#!/bin/sh\nread command\necho "got: $command" >> ${log}\nprintf 'Change effort level?\\nThis conversation is cached for the current effort level.\\n> Yes, switch to low\\n  No, go back\\n'\nread answer\necho "answer: [$answer]" >> ${log}\nclear\nread message\necho "message: $message" >> ${log}\nexec sleep 600\n`, { mode: 0o755 })
        tmux('new-session', '-d', '-s', 'outline-only-effort', agent)
        assert.equal((await send('outline-only-effort', '/effort low')).status, 200)
        const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])
        await until(() => lines().length === 2, { what: 'the effort question to be answered' })
        assert.deepEqual(lines(), ['got: /effort low', 'answer: []'])
        assert.equal((await send('outline-only-effort', 'my message')).status, 200)
        await until(() => lines().length === 3, { what: 'the message to arrive' })
        assert.equal(lines()[2], 'message: my message')
    })
})
