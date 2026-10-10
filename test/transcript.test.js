import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SESSION, eventStream, rawGet, startServer } from './helpers.js'

describe('what the page reads of the transcript', () => {
    let server
    before(async () => (server = await startServer()))
    after(() => server?.stop())

    test('/messages sends the agent’s @message paragraphs, with the node they name', async () => {
        const stream = await eventStream(`${server.url}/messages?id=${SESSION}`)
        try {
            const messages = JSON.parse((await stream.take()).data)
            assert.equal(messages.length, 1)
            assert.equal(messages[0].num, '2.4')
            assert.equal(messages[0].html, '<p>The staging replay finished with an 82% hit rate.</p>\n')
            // The id names the entry, the text block and the paragraph.
            assert.equal(messages[0].id, '00000000-0000-4000-8000-000000000007:0:1')
            assert.equal(messages[0].at, '2026-10-01T09:00:49.000Z')
        } finally {
            stream.close()
        }
    })

    test('/activity says the agent is idle once the turn has ended', async () => {
        const stream = await eventStream(`${server.url}/activity?id=${SESSION}`)
        try {
            const event = await stream.take()
            assert.equal(event.event, 'state')
            assert.equal(event.data, 'idle')
        } finally {
            stream.close()
        }
    })

    test('a session without a transcript is missing', async () => {
        const stream = await eventStream(`${server.url}/messages?id=00000000-0000-4000-8000-000000000000`)
        try {
            assert.equal((await stream.take()).event, 'missing')
        } finally {
            stream.close()
        }
    })

    test('/api/commands lists the commands the session can run', async () => {
        const commands = await (await fetch(`${server.url}/api/commands?session=${SESSION}`)).json()
        assert.ok(commands.some(c => c.name === 'model'))
        assert.ok(commands.every(c => typeof c.name === 'string' && typeof c.source === 'string'))
    })

    test('the outline’s stream carries its linked session: messages and activity', async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events`)
        try {
            assert.equal((await stream.take()).event, 'message')
            assert.equal((await stream.take()).event, 'state')
            // The outline list, for the pane beside the outline.
            assert.equal((await stream.take()).event, 'outlines')
            // The session is named before anything about it.
            assert.deepEqual(await stream.take(), { event: 'session', data: JSON.stringify(SESSION) })
            const messages = await stream.take()
            assert.equal(messages.event, 'messages')
            assert.deepEqual(JSON.parse(messages.data).map(m => m.num), ['2.4'])
            assert.deepEqual(await stream.take(), { event: 'activity', data: '"idle"' })
            // The transcript is long: it comes only when asked for.
            await assert.rejects(stream.take(600), /no event/)
        } finally {
            stream.close()
        }
    })

    test('the stream follows the session the outline links to now', async () => {
        const file = path.join(server.dir, 'demo', 'relinked.md')
        const other = '00000000-0000-4000-8000-000000000000'
        fs.copyFileSync(path.join(server.dir, 'demo', 'sample.md'), file)
        const stream = await eventStream(`${server.url}/api/outline/demo/relinked/events?transcript=1`)
        try {
            await stream.takeOf('transcript')
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`Session: ${SESSION}`, `Session: ${other}`))
            assert.deepEqual(await stream.takeOf('session'), { event: 'session', data: JSON.stringify(other) })
            // That session has no transcript (yet).
            assert.equal((await stream.take()).event, 'transcript-missing')
        } finally {
            stream.close()
            fs.rmSync(file, { force: true })
        }
    })

    test('with ?transcript=1 the outline’s stream sends the transcript as typed entries', async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events?transcript=1`)
        try {
            const entries = JSON.parse((await stream.takeOf('transcript')).data)
            assert.deepEqual(
                entries.map(e => e.type),
                ['user-text', 'assistant-text', 'title', 'tool-use', 'tool-result', 'tool-use', 'tool-result', 'assistant-text', 'user-text', 'assistant-text'],
            )
            assert.deepEqual(entries[0], { type: 'user-text', text: 'How should we cache the search results?' })
            assert.match(entries[1].html, /<strong>2\.1\.1<\/strong>/)
            assert.deepEqual(entries[2], { type: 'title', title: 'Caching search results', custom: false })
            assert.equal(entries[3].name, 'Bash')
            assert.equal(entries[3].summary, 'Replay queries on staging')
            assert.match(entries[3].input, /npm run replay -- --staging/)
            assert.deepEqual(entries[4], { type: 'tool-result', toolUseId: 'toolu_01', text: 'replayed 1000 queries\nhit rate 82%', error: false })
            assert.equal(entries[6].error, true)
        } finally {
            stream.close()
        }
    })

    test('the outline’s stream answers only this machine’s own page', async () => {
        assert.equal((await rawGet(server.url, '/api/outline/demo/sample/events?transcript=1', { host: 'evil.example' })).status, 403)
    })
})
