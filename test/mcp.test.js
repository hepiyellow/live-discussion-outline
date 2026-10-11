import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { after, before, describe, test } from 'node:test'
import { markLedgered } from '../agent.js'
import { ROOT, eventStream, startServer } from './helpers.js'

const SESSION = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const PLUGIN = path.join(ROOT, 'plugin')

/** The plugin's MCP process, as an agent runs it: `request(method, params)` answers with the result of that call. */
function startMcp(server, env = {}) {
    const child = spawn(process.execPath, [path.join(PLUGIN, 'scripts', 'outline-mcp.js')], {
        cwd: server.home,
        env: { ...process.env, HOME: server.home, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PROJECT_DIR: path.join(server.home, 'shop'), TMUX: '', ...env },
        stdio: ['pipe', 'pipe', 'inherit'],
    })
    const waiting = new Map()
    readline.createInterface({ input: child.stdout }).on('line', line => {
        const message = JSON.parse(line)
        waiting.get(message.id)?.(message)
        waiting.delete(message.id)
    })
    let id = 0
    const request = (method, params) =>
        new Promise(resolve => {
            waiting.set(++id, resolve)
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
        })
    /** Calls a tool and returns its text; `error` says whether the tool refused. */
    const tool = async (name, args = {}) => {
        const { result } = await request('tools/call', { name, arguments: args })
        return { text: result.content[0].text, error: !!result.isError }
    }
    return { request, tool, stop: () => child.stdin.end() }
}

/** Runs a hook of the plugin with the JSON the agent gives it, and returns what it prints. */
function runHook(server, event) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(PLUGIN, 'scripts', 'outline-hook.js')], { env: { ...process.env, HOME: server.home }, stdio: ['pipe', 'pipe', 'inherit'] })
        let out = ''
        child.stdout.on('data', d => (out += d))
        child.on('exit', () => resolve(out))
        child.stdin.end(JSON.stringify({ session_id: SESSION, cwd: path.join(server.home, 'shop'), ...event }))
    })
}

describe('an agent keeps an outline through the MCP tools', () => {
    let server, mcp, file
    const outlineText = () => fs.readFileSync(file, 'utf8')
    const page = (pathname, body) =>
        fetch(`${server.url}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.url }, body: JSON.stringify(body) })
    const act = body => page('/api/outline/shop/' + path.basename(file, '.md') + '/act', body)

    before(async () => {
        server = await startServer()
        // The settings file names the port the server took, so the plugin finds it.
        mcp = startMcp(server)
    })
    after(async () => {
        mcp.stop()
        await server.stop()
    })

    test('the process speaks MCP and lists three tools', async () => {
        const { result } = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
        assert.equal(result.serverInfo.name, 'outline')
        assert.deepEqual(result.capabilities, { tools: {} })
        const { result: list } = await mcp.request('tools/list', {})
        assert.deepEqual(list.tools.map(t => t.name), ['start', 'read', 'change'])
    })

    test('a tool before start says to start', async () => {
        const read = await mcp.tool('read')
        assert.equal(read.error, true)
        assert.match(read.text, /Call start first/)
    })

    test('start opens an outline for the session and returns its page', async () => {
        const started = await mcp.tool('start', { title: 'Rate limiting', model: 'Claude Opus 5.5, high' })
        assert.equal(started.error, false)
        assert.match(started.text, /Opened the outline "Rate limiting"/)
        const link = /Page: (\S+)/.exec(started.text)[1]
        assert.match(link, /\/shop\/\d{4}-\d\d-\d\d-rate-limiting$/)
        file = path.join(server.dir, 'shop', `${link.split('/').pop()}.md`)
        assert.match(outlineText(), /^Title: Rate limiting\nModel: Claude Opus 5\.5, high\nSession: 7a1d2c3b-[0-9a-f-]+\nMode: server\n$/)
        // Starting again reattaches: the session has one outline.
        const again = await mcp.tool('start', { title: 'Another name' })
        assert.match(again.text, /Reattached to the outline "Rate limiting"/)
        assert.equal(fs.readdirSync(path.join(server.dir, 'shop')).length, 1)
    })

    test('one change builds the outline, and the server writes the file', async () => {
        const built = await mcp.tool('change', {
            ops: [
                {
                    op: 'add',
                    num: '1',
                    title: 'Where to limit',
                    text: 'Requests are limited per API key.',
                    children: [
                        { title: 'Limit at the gateway', text: 'The gateway already sees every request.', status: 'claim' },
                        { title: 'Storage for counters', text: 'Pick one of the options below.', options: [{ title: 'Redis', text: 'Shared.', recommended: true }, { title: 'In memory', text: 'Per instance.' }] },
                        { title: 'Run the load test', action: 'Runs the k6 script against staging.' },
                    ],
                },
                { op: 'queue', items: [{ num: '1.2' }, { num: '1.3' }, { num: '1.1', label: 'Gateway is the place' }] },
            ],
        })
        assert.equal(built.error, false, built.text)
        assert.match(built.text, /1\.2 Storage for counters \[question, has a recommendation\]/)
        assert.match(built.text, /1\.2\.1 \(A\) Redis \[option, recommended\]/)
        const text = outlineText()
        assert.match(text, /^## 1\.1 @agent-claim Limit at the gateway$/m)
        assert.match(text, /^### 1\.2\.1 @recommended @option_A Redis$/m)
        assert.match(text, /^## 1\.3 @action Run the load test\n\n@Action\. Runs the k6 script against staging\.$/m)
        // The server set each queue item's kind from its node.
        assert.match(text, /# @queue\n- 1\.2 @approve Storage for counters\n- 1\.3 @action Run the load test\n- 1\.1 @approve Gateway is the place\n/)
    })

    test('a change that breaks a rule applies nothing, and says why', async () => {
        const before = outlineText()
        const refused = await mcp.tool('change', { ops: [{ op: 'add', num: '2', title: 'Rollout' }, { op: 'add', num: '1.1', title: 'A second 1.1' }] })
        assert.equal(refused.error, true)
        assert.match(refused.text, /Nothing was applied\. Operation 2 of 2 \(add 1\.1\): The number 1\.1 is taken by "Limit at the gateway"/)
        assert.match(refused.text, /add the new one as 1\.4/)
        assert.equal(outlineText(), before)
        const approved = await mcp.tool('change', { ops: [{ op: 'add', num: '2', title: 'Rollout', status: 'approved' }] })
        assert.match(approved.text, /only the user approves/)
    })

    test('a tick on the page is recorded at once, and the agent is told with the next prompt', async () => {
        const stream = await eventStream(`${server.url}/api/outline/shop/${path.basename(file, '.md')}/events`)
        await stream.take()
        assert.equal((await act({ set: [{ num: '1.1', approved: true }, { num: '1.2.2', approved: true }] })).status, 200)
        const pushed = JSON.parse((await stream.takeOf('message')).data)
        stream.close()
        assert.equal(pushed.nodes[0].children[0].status, 'approved')
        const text = outlineText()
        assert.match(text, /^## 1\.1 @user-approved @agent-claim Limit at the gateway$/m)
        assert.match(text, /^## 1\.2 @user-approved @options Storage for counters$/m)
        assert.match(text, /^### 1\.2\.2 @user-approved @option_B In memory$/m)
        // What the user handled left the queue.
        assert.match(text, /# @queue\n- 1\.3 @action Run the load test\n$/)
        const told = await runHook(server, { hook_event_name: 'UserPromptSubmit', prompt: 'and now?' })
        assert.match(told, /approved 1\.1 Limit at the gateway/)
        assert.match(told, /picked 1\.2\.2 \(B\) In memory/)
        // Told once.
        assert.equal(await runHook(server, { hook_event_name: 'UserPromptSubmit', prompt: 'again' }), '')
    })

    test('new wording of an approved node is a claim again', async () => {
        const updated = await mcp.tool('change', { ops: [{ op: 'update', num: '1.1', text: 'The gateway sees every request, so it limits them.' }] })
        assert.equal(updated.error, false, updated.text)
        assert.match(updated.text, /1\.1 was user-approved; its wording changed, so it is a claim again/)
        assert.match(outlineText(), /^## 1\.1 @agent-claim @current Limit at the gateway$/m)
    })

    test('after compaction the agent gets the map, and must read a node before updating it', async () => {
        const map = await runHook(server, { hook_event_name: 'SessionStart', source: 'compact' })
        assert.match(map, /mirrored into the outline "Rate limiting"/)
        assert.match(map, /1\.1 Limit at the gateway \[claim\]/)
        const stale = await mcp.tool('change', { ops: [{ op: 'update', num: '1.1', text: 'Rewritten from memory.' }] })
        assert.equal(stale.error, true)
        assert.match(stale.text, /1\.1 changed since you last saw it/)
        assert.match(stale.text, /The gateway sees every request, so it limits them\./)
        // The refusal showed the node, so the update can be sent again.
        const again = await mcp.tool('change', { ops: [{ op: 'update', num: '1.1', summary: 'Limit at the gateway.' }] })
        assert.equal(again.error, false, again.text)
        assert.match(outlineText(), /so it limits them\.\n\n@Summary\. Limit at the gateway\.\n/)
    })

    test('Run on the page reaches an agent without a session terminal with its next prompt; finish records the outcome', async () => {
        assert.deepEqual(await (await act({ run: '1.3' })).json(), { typed: false })
        assert.match(await runHook(server, { hook_event_name: 'UserPromptSubmit', prompt: 'go' }), /pressed Run on 1\.3 Run the load test/)
        const done = await mcp.tool('change', { ops: [{ op: 'finish', num: '1.3', outcome: 'p95 stayed under 40 ms at 2,000 rps.' }, { op: 'message', num: '1.3', text: 'The load test passed.' }] })
        assert.equal(done.error, false, done.text)
        assert.match(outlineText(), /^## 1\.3 @current @action-done Run the load test\n\np95 stayed under 40 ms/m)
        assert.doesNotMatch(outlineText(), /@queue/)
        const stream = await eventStream(`${server.url}/api/outline/shop/${path.basename(file, '.md')}/events`)
        const notes = JSON.parse((await stream.takeOf('notes')).data)
        stream.close()
        assert.equal(notes.length, 1)
        assert.equal(notes[0].num, '1.3')
        assert.match(notes[0].html, /The load test passed/)
    })

    test('removing a node renumbers those after it, and read shows one node with its descendants', async () => {
        const removed = await mcp.tool('change', { ops: [{ op: 'remove', num: '1.1' }] })
        assert.match(removed.text, /Numbers changed[^\n]*1\.2 -> 1\.1; 1\.2\.1 -> 1\.1\.1; 1\.2\.2 -> 1\.1\.2; 1\.3 -> 1\.2/)
        const read = await mcp.tool('read', { num: '1.1' })
        assert.match(read.text, /^1\.1 Storage for counters \[question, answered\]\nPick one of the options below\.\n\n1\.1\.1 \(A\) Redis \[option, recommended\]\nShared\.\n\n1\.1\.2 \(B\) In memory \[option, picked\]\nPer instance\.$/)
    })

    test('a session with nothing discussed yet opens an outline without a name, and names it later', async () => {
        const other = startMcp(server, { CLAUDE_CODE_SESSION_ID: '11111111-2222-4333-8444-555555555555', OUTLINE_PROJECT: 'other-project' })
        try {
            const opened = await other.tool('start', { model: 'Claude Opus 5.5' })
            assert.equal(opened.error, false, opened.text)
            assert.match(opened.text, /Opened an outline that is not named yet\./)
            assert.match(opened.text, /filed under the project "other-project"/)
            const target = path.join(server.dir, 'other-project', `${/Page: \S+\/(\S+)/.exec(opened.text)[1]}.md`)
            assert.match(fs.readFileSync(target, 'utf8'), /^Title: New outline\n/)
            const named = await other.tool('start', { title: 'Understand project design' })
            assert.match(named.text, /The outline is now named "Understand project design"/)
            assert.match(fs.readFileSync(target, 'utf8'), /^Title: Understand project design\n/)
            // Named once: from here on the name is the user's.
            const again = await other.tool('start', { title: 'Something else' })
            assert.match(again.text, /Reattached to the outline "Understand project design", filed under the project "other-project"\. Its name is the user's to change/)
            assert.equal(fs.readdirSync(path.join(server.dir, 'other-project')).length, 1)
        } finally {
            other.stop()
        }
    })

    test('the outline keeps its Mode line through every change', () => {
        assert.match(outlineText(), /^Title: [^\n]*\n(?:[A-Z][a-z]+: [^\n]*\n)*Mode: server\n\n/)
    })

    test('a web page cannot call the agent’s API', async () => {
        const res = await fetch(`${server.url}/api/agent/read`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'x-outline-agent': '1' }, body: '{}' })
        assert.equal(res.status, 403)
        assert.equal((await fetch(`${server.url}/api/agent/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403)
    })
})

describe('an outline in file mode is its agent’s: the tools and the hooks leave it alone', () => {
    const OTHER = '22222222-3333-4444-8555-666666666666'
    let server, mcp, kept
    const keptText = () => fs.readFileSync(kept, 'utf8')

    before(async () => {
        server = await startServer()
        // An outline the agent of session OTHER writes itself, in the project the tests' sessions file under.
        kept = path.join(server.dir, 'shop', 'by-hand.md')
        fs.mkdirSync(path.dirname(kept), { recursive: true })
        fs.writeFileSync(kept, `Title: By hand\nSession: ${OTHER}\n\n# 1. Topic\n\n## 1.1 @agent-claim A claim\nIts text,\nwrapped by hand.\n`)
        mcp = startMcp(server, { CLAUDE_CODE_SESSION_ID: OTHER })
    })
    after(async () => {
        mcp.stop()
        await server.stop()
    })

    test('a tool that names it is refused, and says who keeps it', async () => {
        const before = keptText()
        const refused = await mcp.tool('start', { title: 'Mine now', outline: 'shop/by-hand' })
        assert.equal(refused.error, true)
        assert.match(refused.text, /The outline shop\/by-hand is kept by its agent as a file/)
        // The MCP process names an outline only once a call has found it; the server refuses the name all the same.
        const agent = (name, body) => fetch(`${server.url}/api/agent/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outline-agent': '1' }, body: JSON.stringify(body) }).then(r => r.json())
        for (const [name, body] of [['read', {}], ['change', { ops: [{ op: 'add', num: '2', title: 'More' }] }]]) {
            const answer = await agent(name, { ...body, outline: 'shop/by-hand' })
            assert.equal(answer.ok, false, name)
            assert.match(answer.text, /kept by its agent as a file/, name)
        }
        assert.equal(keptText(), before)
    })

    test('its session has no outline for the tools, and the hooks say nothing', async () => {
        // Not even beside an outline the server keeps for an agent that gave no session id, started from the same folder.
        const nameless = startMcp(server, { CLAUDE_CODE_SESSION_ID: '' })
        try {
            const started = await nameless.tool('start', { title: 'No session id' })
            assert.equal(started.error, false, started.text)
            assert.match((await nameless.tool('read')).text, /^Outline "No session id"/)
        } finally {
            nameless.stop()
        }
        assert.match((await mcp.tool('read')).text, /Call start first/)
        const hook = event => runHook(server, { session_id: OTHER, ...event })
        assert.equal(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'and now?' }), '')
        assert.equal(await hook({ hook_event_name: 'SessionStart', source: 'compact' }), '')
        assert.equal(await hook({ hook_event_name: 'SessionStart', source: 'resume' }), '')
    })

    test('start in its session opens a new outline in server mode beside it', async () => {
        const before = keptText()
        const started = await mcp.tool('start', { title: 'By the server' })
        assert.equal(started.error, false, started.text)
        assert.match(started.text, /Opened the outline "By the server"/)
        const made = path.join(server.dir, 'shop', `${/Page: \S+\/(\S+)/.exec(started.text)[1]}.md`)
        assert.notEqual(made, kept)
        assert.match(fs.readFileSync(made, 'utf8'), /\nMode: server\n/)
        assert.equal(keptText(), before)
        // From here on the session's tools are about the new outline.
        assert.match((await mcp.tool('read')).text, /^Outline "By the server"/)
    })

    test('renaming it from the page rewrites its Title line and tells no agent', async () => {
        const res = await fetch(`${server.url}/api/rename`, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.url }, body: JSON.stringify({ project: 'shop', file: 'by-hand', title: 'Renamed by hand' }) })
        assert.equal(res.status, 200)
        assert.match(keptText(), /^Title: Renamed by hand\nSession: /)
        assert.equal(fs.existsSync(path.join(server.dir, '.ledger', 'shop', 'by-hand.json')), false)
    })
})

describe('outlines the server kept before outlines had a mode', () => {
    test('get their Mode line when the server starts, and keep their time of last change', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-only-marked-'))
        const dir = path.join(home, 'outlines')
        const file = path.join(dir, 'shop', 'old.md')
        const byHand = path.join(dir, 'shop', 'by-hand.md')
        fs.mkdirSync(path.join(dir, '.ledger', 'shop'), { recursive: true })
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, 'Title: Old\nSession: 7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d\n\n# 1. Topic\n\nText.\n')
        fs.writeFileSync(path.join(dir, '.ledger', 'shop', 'old.json'), JSON.stringify({ events: [], shown: {}, messages: [], cwd: '/tmp/shop' }))
        fs.writeFileSync(byHand, 'Title: By hand\n\n# 1. Topic\n')
        const then = new Date('2026-01-02T03:04:05Z')
        fs.utimesSync(file, then, then)
        markLedgered(dir)
        try {
            assert.equal(fs.readFileSync(file, 'utf8'), 'Title: Old\nSession: 7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d\nMode: server\n\n# 1. Topic\n\nText.\n')
            assert.equal(fs.statSync(file).mtimeMs, then.getTime())
            // An outline without a ledger was never the server's.
            assert.equal(fs.readFileSync(byHand, 'utf8'), 'Title: By hand\n\n# 1. Topic\n')
            // Marked once.
            markLedgered(dir)
            assert.equal(fs.readFileSync(file, 'utf8').match(/Mode: server/g).length, 1)
        } finally {
            fs.rmSync(home, { recursive: true, force: true })
        }
    })
})
