import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { eventStream, rawGet, startServer } from './helpers.js'

describe('/api/outline', () => {
    let server
    before(async () => (server = await startServer()))
    after(() => server?.stop())

    test('returns the outline', async () => {
        const res = await fetch(`${server.url}/api/outline/demo/sample`)
        assert.equal(res.status, 200)
        assert.match(res.headers.get('content-type'), /^application\/json/)
        const outline = await res.json()
        assert.equal(outline.project, 'demo')
        assert.equal(outline.file, 'sample')
        assert.equal(outline.title, 'Caching for the search service')
        assert.equal(outline.nodes.length, 4)
        assert.equal(outline.queue.length, 4)
        // The fixture transcript says where the session runs.
        assert.equal(outline.folder, '/home/dev/search')
        assert.equal(typeof outline.terminalTab, 'boolean')
    })

    test('a missing or badly named outline is a 404', async () => {
        for (const p of ['/api/outline/demo/nope', '/api/outline/demo/.hidden', '/api/outline/demo', '/api/outline/demo/sample/other'])
            assert.equal((await fetch(server.url + p)).status, 404, p)
    })

    test('only this machine’s own page may read it', async () => {
        const res = await rawGet(server.url, '/api/outline/demo/sample', { host: 'evil.example' })
        assert.equal(res.status, 403)
    })

    test('the stream sends the outline, then again when the file changes', async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events`)
        try {
            const first = JSON.parse((await stream.take()).data)
            assert.equal((await stream.take()).event, 'state')
            assert.equal(first.nodes.find(n => n.num === '4').children[0].status, 'claim')
            server.swap('demo/sample', 'demo/sample-edited')
            const next = JSON.parse((await stream.take()).data)
            assert.equal(next.nodes.find(n => n.num === '4').children[0].status, 'approved')
            assert.ok(next.nodes.find(n => n.num === '3').children.some(n => n.num === '3.4'))
        } finally {
            stream.close()
            server.swap('demo/sample', 'demo/sample')
        }
    })

    test('the stream ignores changes to other outlines', async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events`)
        try {
            await stream.take()
            await stream.take()
            fs.writeFileSync(path.join(server.dir, 'demo', 'other.md'), 'Title: Other\n\n# 1. A\n')
            await assert.rejects(stream.take(600), /no event/)
        } finally {
            stream.close()
            fs.rmSync(path.join(server.dir, 'demo', 'other.md'), { force: true })
        }
    })

    test('the stream says when the outline is gone', async () => {
        fs.copyFileSync(path.join(server.dir, 'demo', 'sample.md'), path.join(server.dir, 'demo', 'doomed.md'))
        const stream = await eventStream(`${server.url}/api/outline/demo/doomed/events`)
        try {
            await stream.take()
            await stream.take()
            fs.rmSync(path.join(server.dir, 'demo', 'doomed.md'))
            assert.equal((await stream.take()).event, 'gone')
        } finally {
            stream.close()
        }
    })

    test('the old page still renders the outline', async () => {
        const res = await fetch(`${server.url}/demo/sample`)
        assert.equal(res.status, 200)
        const html = await res.text()
        assert.match(html, /Caching for the search service/)
        assert.match(html, /data-num="3\.1\.1\.1\.1\.1"/)
        assert.match(html, /◉ Pick one/)
        assert.match(html, /💡 Recommended/)
        assert.match(html, /<div class="rec-line"><span class="pill sum"/)
        assert.match(html, /class="q q-decide" data-num="2\.1"/)
    })

    test('the old outline list still reads the outline', async () => {
        const html = await (await fetch(`${server.url}/`)).text()
        assert.match(html, /Caching for the search service/)
    })
})
