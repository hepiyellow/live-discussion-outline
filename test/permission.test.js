import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

// Permission prompts on the page: the store of prompts that wait for the user, and the watch on the session's
// transcript that tells when one was answered in the terminal. The transcripts are read from HOME, so HOME is a
// temporary folder, set before the modules that read it are loaded.

const SESSION = '5e6f7a8b-1c2d-4e3f-9a0b-1c2d3e4f5a6b'
const wait = ms => new Promise(r => setTimeout(r, ms))
const realHome = process.env.HOME
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-only-permission-'))
process.env.HOME = home
after(() => {
    process.env.HOME = realHome
    fs.rmSync(home, { recursive: true, force: true })
})

describe('the prompts that wait for the user', () => {
    let createPermissions, promptSummary
    before(async () => ({ createPermissions, promptSummary } = await import('../permission.js')))
    /** A store whose changes and notes are kept, and whose transcript watch is the test's to fire. */
    const store = (options = {}) => {
        const changes = []
        const notes = []
        const watching = []
        const permissions = createPermissions({
            onChange: (p, f) => changes.push(`${p}/${f}`),
            note: (p, f, text) => notes.push(text),
            watch: (session, tool, input, onSettled) => {
                const w = { session, tool, input, onSettled, stopped: false }
                watching.push(w)
                return () => (w.stopped = true)
            },
            ...options,
        })
        return { permissions, changes, notes, watching }
    }
    const bash = { session: SESSION, tool: 'Bash', input: { command: 'npm test\n# all of them', description: 'Run the tests' }, mode: 'acceptEdits' }

    test('a prompt shows with what it asks, and Allow on the page is its answer', async () => {
        const { permissions, changes, notes, watching } = store()
        const prompt = permissions.ask('shop', 'limits', bash)
        const [shown] = permissions.list('shop', 'limits')
        assert.equal(shown.id, prompt.id)
        assert.deepEqual({ tool: shown.tool, summary: shown.summary, mode: shown.mode }, { tool: 'Bash', summary: 'npm test', mode: 'acceptEdits' })
        assert.match(shown.input, /"command": "npm test\\n# all of them"/)
        assert.deepEqual(permissions.list('shop', 'other'), [])
        assert.equal(permissions.answer('shop', 'limits', prompt.id, 'allow'), true)
        assert.deepEqual(await prompt.done, { behavior: 'allow' })
        // It is gone from the page, nothing is left in the inbox, and the transcript is no longer watched.
        assert.deepEqual(permissions.list('shop', 'limits'), [])
        assert.deepEqual(changes, ['shop/limits', 'shop/limits'])
        assert.deepEqual(notes, [])
        assert.equal(watching[0].stopped, true)
        // Answered once.
        assert.equal(permissions.answer('shop', 'limits', prompt.id, 'deny'), false)
    })

    test('Deny hands the agent a reason', async () => {
        const { permissions } = store()
        const prompt = permissions.ask('shop', 'limits', bash)
        permissions.answer('shop', 'limits', prompt.id, 'deny')
        assert.deepEqual(await prompt.done, { behavior: 'deny', message: 'The user denied this on the outline page.' })
    })

    test('a prompt the user dismisses stays the terminal\'s, and a message says so', async () => {
        const { permissions, notes } = store()
        const prompt = permissions.ask('shop', 'limits', bash)
        assert.equal(permissions.answer('shop', 'limits', prompt.id, 'dismiss'), true)
        assert.equal(await prompt.done, null)
        assert.deepEqual(notes, ["A permission prompt is waiting in the session's terminal: **Bash** `npm test`. Answer it there."])
    })

    test('a prompt answered in the terminal goes, with no message', async () => {
        const { permissions, notes, watching } = store()
        const prompt = permissions.ask('shop', 'limits', bash)
        assert.deepEqual([watching[0].session, watching[0].tool, watching[0].input], [SESSION, 'Bash', bash.input])
        watching[0].onSettled()
        assert.equal(await prompt.done, null)
        assert.deepEqual(permissions.list('shop', 'limits'), [])
        assert.deepEqual(notes, [])
    })

    test('a prompt nobody answers in time is let go, with a message; one whose hook left, without', async () => {
        const { permissions, notes } = store({ askMs: 30 })
        const late = permissions.ask('shop', 'limits', bash)
        // The wait keeps the test alive: the prompt's own timer does not keep a server from ending.
        assert.equal((await Promise.all([late.done, wait(150)]))[0], null)
        assert.equal(notes.length, 1)
        const left = permissions.ask('shop', 'limits', bash)
        left.gone()
        assert.equal(await left.done, null)
        assert.equal(notes.length, 1)
        assert.deepEqual(permissions.list('shop', 'limits'), [])
    })

    test('several prompts wait in the order they came', () => {
        const { permissions } = store()
        const first = permissions.ask('shop', 'limits', bash)
        const second = permissions.ask('shop', 'limits', { ...bash, tool: 'Write', input: { file_path: '/tmp/a.txt', content: 'x' } })
        assert.deepEqual(permissions.list('shop', 'limits').map(p => p.id), [first.id, second.id])
        assert.equal(permissions.list('shop', 'limits')[1].summary, '/tmp/a.txt')
        assert.equal(promptSummary('WebFetch', { url: 'https://example.com', prompt: 'read' }), 'https://example.com')
        assert.equal(promptSummary('Odd', null), '')
    })
})

describe('the watch on a tool call that waits for permission', () => {
    let watchToolCall
    const file = path.join(home, '.claude', 'projects', '-tmp-shop', `${SESSION}.jsonl`)
    const log = entries => fs.appendFileSync(file, entries.map(e => `${JSON.stringify({ sessionId: SESSION, ...e })}\n`).join(''))
    const call = (id, input, name = 'Bash') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
    const result = id => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
    const settledSoon = async watchers => {
        for (let i = 0; i < 40 && !watchers.settled; i++) await wait(50)
        return watchers.settled
    }
    before(async () => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, '')
        ;({ watchToolCall } = await import('../transcript.js'))
    })

    test('it settles when the result of that call is written, not for an earlier call of the same command', async () => {
        // The same command, run and answered before; then the call that waits now. The input's keys come in another order.
        log([call('t-1', { command: 'npm test', description: 'Run the tests' }), result('t-1'), call('t-2', { description: 'Run the tests', command: 'npm test' })])
        const state = { settled: false }
        const stop = watchToolCall(SESSION, 'Bash', { command: 'npm test', description: 'Run the tests' }, () => (state.settled = true))
        await wait(300)
        assert.equal(state.settled, false)
        // Another tool's result does not settle it.
        log([call('t-3', { file_path: '/tmp/a' }, 'Read'), result('t-3')])
        await wait(300)
        assert.equal(state.settled, false)
        log([result('t-2')])
        assert.equal(await settledSoon(state), true)
        stop()
    })

    test('a call Claude Code writes a moment late is found when it comes', async () => {
        const state = { settled: false }
        const stop = watchToolCall(SESSION, 'Bash', { command: 'make deploy' }, () => (state.settled = true))
        await wait(150)
        log([call('t-9', { command: 'make deploy' })])
        await wait(300)
        assert.equal(state.settled, false)
        log([result('t-9')])
        assert.equal(await settledSoon(state), true)
        stop()
    })

    test('once stopped it says nothing more; without a transcript it watches nothing', async () => {
        log([call('t-10', { command: 'ls' })])
        const state = { settled: false }
        const stop = watchToolCall(SESSION, 'Bash', { command: 'ls' }, () => (state.settled = true))
        stop()
        log([result('t-10')])
        await wait(400)
        assert.equal(state.settled, false)
        watchToolCall('00000000-0000-4000-8000-000000000000', 'Bash', {}, () => assert.fail('no transcript'))()
        watchToolCall('not a session', 'Bash', {}, () => assert.fail('no session'))()
    })
})
