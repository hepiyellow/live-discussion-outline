import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { SESSION, eventStream, startServer } from './helpers.js'

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
})
