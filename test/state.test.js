import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createStateStore } from '../state.js'
import { eventStream, rawGet, startServer } from './helpers.js'

describe('the state store', () => {
    let root, store
    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-state-'))
        store = createStateStore(root)
    })
    after(() => fs.rmSync(root, { recursive: true, force: true }))

    test('an outline without state starts empty', () => {
        assert.deepEqual(store.read('demo', 'sample'), { open: {}, overrides: {}, sent: {}, backTo: {}, read: {}, runs: {}, seen: {}, undo: [], draft: '', chips: [] })
    })

    test('a patch changes single entries, and null deletes one', () => {
        store.patch('demo', 'sample', { open: { '3.1': false, 1: true }, overrides: { '2.3': true } })
        store.patch('demo', 'sample', { open: { '3.1': true, '2.2': false } })
        store.patch('demo', 'sample', { open: { 1: null } })
        const state = store.read('demo', 'sample')
        assert.deepEqual(state.open, { '3.1': true, '2.2': false })
        assert.deepEqual(state.overrides, { '2.3': true })
    })

    test('undo and the draft are replaced whole', () => {
        store.patch('demo', 'sample', { undo: [{ nodes: [], collapsed: [] }], draft: 'hello' })
        store.patch('demo', 'sample', { undo: [] })
        const state = store.read('demo', 'sample')
        assert.deepEqual(state.undo, [])
        assert.equal(state.draft, 'hello')
    })

    test('the state lives in .state/ of the outlines folder, one file per outline', () => {
        assert.ok(fs.existsSync(path.join(root, '.state', 'demo', 'sample.json')))
        assert.deepEqual(store.read('demo', 'other').open, {})
    })

    test('bad patches are refused and change nothing', () => {
        const before = store.read('demo', 'sample')
        for (const bad of [null, [], { nope: {} }, { open: [] }, { open: { __proto__x: { a: 1 } } }, { open: { 'a b': true } }, { undo: {} }, { draft: 3 }, { backTo: { 1: 'x'.repeat(201) } }, { chips: [{ label: 1 }] }, { read: { 1: 'x'.repeat(50001) } }])
            assert.throws(() => store.patch('demo', 'sample', bad), undefined, JSON.stringify(bad))
        assert.deepEqual(store.read('demo', 'sample'), before)
    })

    test('an unreadable file reads as empty', () => {
        fs.writeFileSync(path.join(root, '.state', 'demo', 'broken.json'), '{nope')
        assert.deepEqual(store.read('demo', 'broken').open, {})
    })
})

describe('/api/state', () => {
    let server
    before(async () => (server = await startServer()))
    after(() => server?.stop())

    const patch = (body, headers = {}) =>
        fetch(`${server.url}/api/state/demo/sample`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', origin: server.url, ...headers },
            body: JSON.stringify(body),
        })

    test('GET returns the state, PATCH changes it', async () => {
        assert.deepEqual((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).open, {})
        const res = await patch({ open: { '3.1': false } })
        assert.equal(res.status, 200)
        assert.deepEqual((await res.json()).open, { '3.1': false })
        assert.deepEqual((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).open, { '3.1': false })
    })

    test('a PATCH must come from this machine’s own page, as JSON', async () => {
        assert.equal((await patch({ open: {} }, { origin: 'http://evil.example' })).status, 403)
        const res = await fetch(`${server.url}/api/state/demo/sample`, { method: 'PATCH', headers: { origin: server.url, 'content-type': 'text/plain' }, body: '{}' })
        assert.equal(res.status, 403)
        assert.equal((await rawGet(server.url, '/api/state/demo/sample', { host: 'evil.example' })).status, 403)
    })

    test('a bad patch, or no such outline, is refused', async () => {
        assert.equal((await patch({ nope: 1 })).status, 400)
        const res = await fetch(`${server.url}/api/state/demo/nope`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: server.url }, body: '{}' })
        assert.equal(res.status, 404)
    })

    test('the outline’s stream sends the state, then each change of it, and no outline for it', async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events`)
        try {
            assert.equal((await stream.take()).event, 'message')
            const first = await stream.take()
            assert.equal(first.event, 'state')
            await patch({ open: { 2: false } })
            const next = await stream.take()
            assert.equal(next.event, 'state')
            assert.equal(JSON.parse(next.data).open['2'], false)
            // The state file is in the outlines folder, but writing it is not an outline change.
            await assert.rejects(stream.take(600), /no event/)
        } finally {
            stream.close()
        }
    })

    test('the old page’s change events ignore state writes', async () => {
        const stream = await eventStream(`${server.url}/events`)
        try {
            await patch({ open: { 4: false } })
            await assert.rejects(stream.take(600), /no event/)
        } finally {
            stream.close()
        }
    })
})
