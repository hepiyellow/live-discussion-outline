import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

// What reaches the inbox without the agent posting it: the reply of a turn that changed nothing in the outline, and
// the output of local commands, which Claude Code runs without a turn. The transcripts are read from HOME, so HOME is a
// temporary folder, set before the modules that read it are loaded.

const SESSION = '7c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f'
const wait = ms => new Promise(r => setTimeout(r, ms))
const realHome = process.env.HOME
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-only-turns-'))
process.env.HOME = home
after(() => {
    process.env.HOME = realHome
    fs.rmSync(home, { recursive: true, force: true })
})

describe('local commands in a transcript', () => {
    let localCommandsIn
    before(async () => ({ localCommandsIn } = await import('../transcript.js')))
    const at = '2026-10-11T20:38:40.385Z'
    const user = (content, more = {}) => ({ type: 'user', uuid: `u-${content.length}`, timestamp: at, message: { role: 'user', content }, ...more })
    const system = (content, uuid) => ({ type: 'system', subtype: 'local_command', uuid, timestamp: at, content })

    test('a command written as user entries: its name and arguments, then its output', () => {
        const entries = [
            user('<local-command-caveat>The command below was run directly.</local-command-caveat>', { isMeta: true }),
            user('<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>claude-opus-5-5</command-args>'),
            { ...user('<local-command-stdout>Set model to `Opus 5.5`</local-command-stdout>'), uuid: 'out-1' },
        ]
        assert.deepEqual(localCommandsIn(entries), [{ id: 'cmd:out-1', at, command: '/model claude-opus-5-5', output: 'Set model to `Opus 5.5`' }])
    })

    test('a command written as system entries; the markdown Claude Code wrote for the agent is its output', () => {
        const entries = [
            system('<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>', 's-1'),
            system('<local-command-stdout> \x1b[1mContext Usage\x1b[22m\n\x1b[38;5;244m⛀ \x1b[39m 25%</local-command-stdout>', 's-2'),
            user('## Context Usage\n\n**Tokens:** 252.8k / 1m (25%)', { isMeta: true }),
        ]
        assert.deepEqual(localCommandsIn(entries), [{ id: 'cmd:s-2', at, command: '/context', output: '## Context Usage\n\n**Tokens:** 252.8k / 1m (25%)' }])
        // Without it, the terminal's output, less its colors.
        assert.equal(localCommandsIn(entries.slice(0, 2))[0].output, 'Context Usage\n⛀  25%')
    })

    test('a skill the user invoked is not a local command, nor is a prompt', () => {
        const entries = [
            user('<command-message>outline</command-message>\n<command-name>/outline</command-name>\n<command-args>Topic</command-args>'),
            { type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'Started.' }] } },
            user('what does this do?'),
            { ...user('<local-command-stdout>Reloaded: 1 plugin</local-command-stdout>'), uuid: 'out-2' },
        ]
        // The output that came with no command named before it has none.
        assert.deepEqual(localCommandsIn(entries), [{ id: 'cmd:out-2', at, command: '', output: 'Reloaded: 1 plugin' }])
    })
})

describe('what a turn leaves in the inbox', () => {
    let root, api, told
    const transcript = () => path.join(home, '.claude', 'projects', '-tmp-shop', `${SESSION}.jsonl`)
    const log = entries => fs.appendFileSync(transcript(), entries.map(e => `${JSON.stringify({ sessionId: SESSION, ...e })}\n`).join(''))
    let outline, project, file
    const inbox = () => api.messages(project, file).map(m => m.html.replace(/<[^>]+>/g, '').trim())

    before(async () => {
        root = path.join(home, 'outlines')
        fs.mkdirSync(root)
        fs.mkdirSync(path.dirname(transcript()), { recursive: true })
        // A command run before the outline existed: not news for it.
        log([{ type: 'user', uuid: 'old', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: '<local-command-stdout>Old output</local-command-stdout>' } }])
        const { createAgentApi } = await import('../agent.js')
        told = []
        api = createAgentApi({ root, config: {}, linkBase: () => 'http://localhost:1', onMessages: (p, f) => told.push(`${p}/${f}`), typeInto: async () => {} })
        const started = api.start({ session: SESSION, cwd: '/tmp/shop', project: 'shop', title: 'Rate limiting' })
        assert.equal(started.ok, true, started.text)
        outline = started.outline
        ;[project, file] = outline.split('/')
        const built = api.change({ outline, ops: [{ op: 'add', num: '1', title: 'Where to limit', children: [{ title: 'At the gateway', status: 'claim' }] }] })
        assert.equal(built.ok, true, built.text)
    })

    test('the reply of a turn that changed nothing in the outline becomes a message', () => {
        api.pending({ outline })
        assert.equal(api.ending({ outline, reply: 'Not as documented: `/btw` runs on the session\'s model.' }).text, '')
        assert.deepEqual(inbox(), ["Not as documented: /btw runs on the session's model."])
        assert.deepEqual(told, [outline])
    })

    test('the reply of a turn that changed the outline does not: the outline holds it', () => {
        api.pending({ outline })
        assert.equal(api.change({ outline, ops: [{ op: 'add', num: '1.2', title: 'Per API key' }] }).ok, true)
        api.ending({ outline, reply: 'Outline updated: 1.2.' })
        assert.equal(inbox().length, 1)
        // The next turn starts clean: its reply counts again.
        api.pending({ outline })
        api.ending({ outline, reply: 'Yes.' })
        assert.deepEqual(inbox().slice(1), ['Yes.'])
    })

    test('a turn without a reply leaves nothing', () => {
        api.pending({ outline })
        api.ending({ outline, reply: '  ' })
        api.ending({ outline })
        assert.equal(inbox().length, 2)
    })

    test('a turn held open over ticks keeps its reply: the answer is not what the agent says after acknowledging', async () => {
        api.pending({ outline })
        await api.act(project, file, { set: [{ num: '1.1', approved: true }] })
        // Told of the tick with the user's next prompt, the agent answers without acknowledging it.
        assert.match(api.pending({ outline }).text, /approved 1\.1 At the gateway/)
        assert.match(api.ending({ outline, reply: 'The gateway is the cheaper place to limit.' }).text, /You have not acknowledged it/)
        assert.equal(inbox().length, 2)
        // An acknowledgement alone changes nothing in the outline.
        assert.equal(api.change({ outline, ops: [{ op: 'acknowledge' }] }).ok, true)
        assert.equal(api.ending({ outline, active: true, reply: 'Acknowledged.' }).text, '')
        assert.deepEqual(inbox().slice(2), ['The gateway is the cheaper place to limit.'])
    })

    test('a turn already held open is not held again', async () => {
        api.pending({ outline })
        await api.act(project, file, { set: [{ num: '1.2', approved: true }] })
        api.pending({ outline })
        assert.equal(api.ending({ outline, active: true, reply: '' }).text, '')
    })

    test('a local command the session ran becomes a message, with its name; one run before the outline does not', async () => {
        const before = inbox().length
        await wait(5)
        const at = new Date().toISOString()
        log([
            { type: 'user', uuid: 'c-1', timestamp: at, message: { role: 'user', content: '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>high</command-args>' } },
            { type: 'user', uuid: 'c-2', timestamp: at, message: { role: 'user', content: '<local-command-stdout>Set effort level to high</local-command-stdout>' } },
        ])
        told.length = 0
        // The page that follows the session saw the output.
        api.commands(project, file)
        assert.deepEqual(inbox().slice(before), ['/effort high\nSet effort level to high'])
        assert.deepEqual(told, [outline])
        // Looked at again, by the page or by a hook, it is not taken twice.
        api.commands(project, file)
        api.pending({ outline })
        api.ending({ outline })
        assert.equal(inbox().length, before + 1)
        assert.equal(inbox().includes('Old output'), false)
    })

    test('with no page open, the next prompt takes the commands run since', async () => {
        const before = inbox().length
        await wait(5)
        log([{ type: 'system', subtype: 'local_command', uuid: 'c-3', timestamp: new Date().toISOString(), content: '<local-command-stdout>Kept model as `Opus 5.5`</local-command-stdout>' }])
        api.pending({ outline })
        assert.deepEqual(inbox().slice(before), ['Kept model as Opus 5.5'])
    })

    test("the server's own renaming of the session is not a message; a /rename the user typed is", async () => {
        const before = inbox().length
        // The session has a session terminal, and the user names the outline on the page: the server types /rename.
        api.start({ session: SESSION, terminal: 'shop-t' })
        api.userEvent(project, file, { kind: 'renamed', title: 'Throttling' })
        await wait(5)
        const renamed = (name, id) => {
            const at = new Date().toISOString()
            return [
                { type: 'system', subtype: 'local_command', uuid: `${id}-a`, timestamp: at, content: `<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>${name}</command-args>` },
                { type: 'system', subtype: 'local_command', uuid: `${id}-b`, timestamp: at, content: `<local-command-stdout>Session renamed to: ${name}</local-command-stdout>` },
            ]
        }
        log(renamed('Throttling', 'r-1'))
        api.commands(project, file)
        assert.equal(inbox().length, before)
        await wait(5)
        log(renamed('Quotas', 'r-2'))
        api.commands(project, file)
        assert.deepEqual(inbox().slice(before), ['/rename Quotas\nSession renamed to: Quotas'])
    })
})
