import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createAgentApi } from '../agent.js'

const PAUSE = 60
const wait = ms => new Promise(r => setTimeout(r, ms))

describe('the user’s ticks reach the agent once the user pauses', () => {
    let root, api, typed
    /** An outline with three claims, opened for a session terminal (or for none). */
    const outlineFor = terminal => {
        const { project, file } = api.open({ project: 'shop', cwd: root, terminal, title: `Rate limiting ${terminal}` })
        const outline = `${project}/${file}`
        const built = api.change({ outline, ops: [{ op: 'add', num: '1', title: 'Where to limit', children: ['At the gateway', 'Per API key', 'With Redis'].map(title => ({ title, status: 'claim' })) }] })
        assert.equal(built.ok, true, built.text)
        return { project, file, outline }
    }
    const tick = (o, ...nums) => api.act(o.project, o.file, { set: nums.map(num => ({ num, approved: true })) })

    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-only-ticks-'))
        typed = []
        api = createAgentApi({ root, config: {}, linkBase: () => 'http://localhost:1', tickPause: PAUSE, typeInto: async (terminal, text) => typed.push([terminal, text]) })
    })
    after(() => fs.rmSync(root, { recursive: true, force: true }))

    test('a run of ticks is typed into the session terminal as one line, and the hook hands over what was ticked', async () => {
        const o = outlineFor('shop-1')
        await tick(o, '1.1')
        await wait(PAUSE / 3)
        await tick(o, '1.2')
        // Not before the pause after the last tick.
        await wait(PAUSE / 2)
        assert.deepEqual(typed, [])
        await wait(PAUSE)
        assert.deepEqual(typed, [['shop-1', 'Ticked in the outline: approved 1.1, 1.2.']])
        assert.match(api.pending({ outline: o.outline }).text, /approved 1\.1 At the gateway; 1\.2 Per API key/)
    })

    test('a message the user sends within the pause takes the ticks along, and nothing is typed', async () => {
        typed.length = 0
        const o = outlineFor('shop-2')
        await tick(o, '1.3')
        assert.match(api.pending({ outline: o.outline }).text, /approved 1\.3 With Redis/)
        await wait(PAUSE * 2)
        assert.deepEqual(typed, [])
    })

    test('an approval taken back is told too, and a node ticked and unticked says only where it ended up', async () => {
        typed.length = 0
        const o = outlineFor('shop-3')
        await tick(o, '1.1', '1.2')
        api.pending({ outline: o.outline })
        await api.act(o.project, o.file, { set: [{ num: '1.1', approved: false }, { num: '1.3', approved: true }] })
        await api.act(o.project, o.file, { set: [{ num: '1.3', approved: false }] })
        await wait(PAUSE * 2)
        assert.deepEqual(typed, [['shop-3', 'Ticked in the outline: took back 1.1, 1.3.']])
    })

    test('a tick is unacknowledged until the agent, told of it, makes a change; the turn-end hook asks for that', async () => {
        const o = outlineFor('shop-4')
        await tick(o, '1.1', '1.2')
        assert.deepEqual(api.unacknowledged(o.project, o.file), ['1.1', '1.2'])
        // Not told yet: nothing to hold the turn open for, and a change does not acknowledge what the agent has not seen.
        assert.equal(api.ending({ outline: o.outline }).text, '')
        const first = api.change({ outline: o.outline, ops: [{ op: 'acknowledge' }] })
        assert.match(first.text, /approved 1\.1 At the gateway; 1\.2 Per API key/)
        assert.deepEqual(api.unacknowledged(o.project, o.file), ['1.1', '1.2'])
        // Told by that result: the hook now holds the turn open, until any change acknowledges.
        assert.match(api.ending({ outline: o.outline }).text, /- approved 1\.1 At the gateway; 1\.2 Per API key\nYou have not acknowledged it/)
        // The numbers follow a node that moves: 1.1 goes, so 1.2 is 1.1 now, and a tick made meanwhile stays.
        await tick(o, '1.3')
        const second = api.change({ outline: o.outline, ops: [{ op: 'remove', num: '1.1' }] })
        assert.equal(second.ok, true, second.text)
        assert.deepEqual(api.unacknowledged(o.project, o.file), ['1.2'])
        assert.equal((api.change({ outline: o.outline, ops: [{ op: 'acknowledge' }] })).ok, true)
        assert.deepEqual(api.unacknowledged(o.project, o.file), [])
        assert.equal(api.ending({ outline: o.outline }).text, '')
    })

    test('without a session terminal the ticks wait for the user’s next prompt', async () => {
        typed.length = 0
        const o = outlineFor('')
        await tick(o, '1.1')
        await wait(PAUSE * 2)
        assert.deepEqual(typed, [])
        assert.match(api.pending({ outline: o.outline }).text, /approved 1\.1 At the gateway/)
    })
})

describe('a title the user gives on the page names the linked session', () => {
    let root, api, typed, prompting
    const session = n => `aaaaaaaa-2222-4333-8444-55555555555${n}`

    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-only-named-'))
        typed = []
        prompting = false
        api = createAgentApi({ root, config: {}, linkBase: () => 'http://localhost:1', typeInto: async (terminal, text) => typed.push([terminal, text]), prompting: () => prompting })
    })
    after(() => fs.rmSync(root, { recursive: true, force: true }))

    test('as /rename typed into its session terminal, once its agent has attached: a session still starting loses what is typed', async () => {
        const { project, file } = api.open({ project: 'shop', cwd: root, terminal: 'shop-1' })
        assert.equal(api.untitled(project, file), true)
        api.userEvent(project, file, { kind: 'renamed', title: 'Rate limiting' })
        assert.equal(api.untitled(project, file), false)
        await wait(10)
        assert.deepEqual(typed, [])
        const attached = api.start({ session: session(1), terminal: 'shop-1', cwd: root, project: 'shop', title: 'What the agent would call it' })
        assert.match(attached.text, /renamed the outline to "Rate limiting"/)
        await wait(10)
        assert.deepEqual(typed, [['shop-1', '/rename Rate limiting']])
        // Attached, a later rename is typed at once, as one line without control characters, and only once.
        api.userEvent(project, file, { kind: 'renamed', title: 'Throttling\u001b[201~\nnow' })
        await wait(10)
        api.start({ session: session(1), terminal: 'shop-1' })
        await wait(10)
        assert.deepEqual(typed.slice(1), [['shop-1', '/rename Throttling[201~now']])
    })

    test('not while a permission prompt waits: the line would answer it', async () => {
        typed.length = 0
        const { project, file } = api.open({ project: 'shop', cwd: root, terminal: 'shop-2' })
        api.start({ session: session(2), terminal: 'shop-2', cwd: root, project: 'shop' })
        prompting = true
        api.userEvent(project, file, { kind: 'renamed', title: 'Quotas' })
        await wait(10)
        assert.deepEqual(typed, [])
        // The prompt is answered: the server asks again.
        prompting = false
        await api.nameSession(project, file)
        assert.deepEqual(typed, [['shop-2', '/rename Quotas']])
    })

    test('a title the agent gives is not typed, and without a session terminal the session keeps its name', async () => {
        typed.length = 0
        const opened = api.open({ project: 'shop', cwd: root, terminal: 'shop-3' })
        assert.match(api.start({ session: session(3), terminal: 'shop-3', cwd: root, project: 'shop', title: 'Named by the agent' }).text, /The outline is now named "Named by the agent"/)
        assert.equal(api.untitled(opened.project, opened.file), false)
        const [project, file] = api.start({ session: session(4), cwd: path.join(root, 'elsewhere'), project: 'docs' }).outline.split('/')
        api.userEvent(project, file, { kind: 'renamed', title: 'Named on the page' })
        await wait(10)
        assert.deepEqual(typed, [])
    })
})
