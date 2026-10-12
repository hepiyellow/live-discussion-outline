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
        // The tests may themselves run in a session the page started, which has a project of its own.
        env: { ...process.env, HOME: server.home, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PROJECT_DIR: path.join(server.home, 'shop'), TMUX: '', OUTLINE_PROJECT: '', ...env },
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
        // Nobody named a workflow skill: the outline records the plugin's own, and the agent is told which to load.
        assert.match(outlineText(), /^Title: Rate limiting\nModel: Claude Opus 5\.5, high\nSession: 7a1d2c3b-[0-9a-f-]+\nMode: server\nWorkflow: outline-only:outline-workflow\n$/)
        assert.match(started.text, /Workflow skill of this outline: outline-only:outline-workflow\. Load it/)
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
        // An action line is one short sentence: the details belong in the node's text.
        const long = 'Adds a retry wrapper to client.js, runs its tests, updates the README and then rebuilds the page for everyone.'
        const wordy = await mcp.tool('change', { ops: [{ op: 'add', num: '2', title: 'Rollout', action: long }] })
        assert.match(wordy.text, /The action of node 2 is \d+ characters long, and an action line has at most 100/)
        assert.match((await mcp.tool('change', { ops: [{ op: 'update', num: '1.3', action: long }] })).text, /at most 100/)
        assert.equal(outlineText(), before)
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

    test('the turn-end hook holds a turn open once over ticks the agent was told of and has not acknowledged', async () => {
        // The last test told the agent of the ticks on 1.1 and 1.2.2: ending the turn now is held open, with the reason.
        const held = JSON.parse(await runHook(server, { hook_event_name: 'Stop' }))
        assert.equal(held.decision, 'block')
        assert.match(held.reason, /- approved 1\.1 Limit at the gateway\n- picked 1\.2\.2 \(B\) In memory\nYou have not acknowledged it/)
        // Once per turn: a turn that goes on because the hook held it ends when the agent ends it again.
        assert.equal(await runHook(server, { hook_event_name: 'Stop', stop_hook_active: true }), '')
        // A change that holds the acknowledge operation alone settles it.
        const acknowledged = await mcp.tool('change', { ops: [{ op: 'acknowledge' }] })
        assert.equal(acknowledged.error, false, acknowledged.text)
        assert.equal(await runHook(server, { hook_event_name: 'Stop' }), '')
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

    test('the turn-end hook hands over the turn\'s reply, which shows in the inbox when the turn changed nothing in the outline', async () => {
        const notes = async () => {
            const stream = await eventStream(`${server.url}/api/outline/shop/${path.basename(file, '.md')}/events`)
            const list = JSON.parse((await stream.takeOf('notes')).data)
            stream.close()
            return list.map(m => m.html.replace(/<[^>]+>/g, '').trim())
        }
        const before = (await notes()).length
        await runHook(server, { hook_event_name: 'UserPromptSubmit', prompt: 'where do we limit?' })
        assert.equal(await runHook(server, { hook_event_name: 'Stop', last_assistant_message: 'At the gateway: it sees every request.' }), '')
        assert.deepEqual((await notes()).slice(before), ['At the gateway: it sees every request.'])
        // A turn that changed the outline says so there: its reply is not a message.
        await runHook(server, { hook_event_name: 'UserPromptSubmit', prompt: 'note that' })
        const added = await mcp.tool('change', { ops: [{ op: 'add', num: '2', title: 'Noted in passing' }] })
        assert.equal(added.error, false, added.text)
        assert.equal(await runHook(server, { hook_event_name: 'Stop', last_assistant_message: 'Outline updated: 2.' }), '')
        assert.equal((await notes()).length, before + 1)
        const removed = await mcp.tool('change', { ops: [{ op: 'remove', num: '2' }] })
        assert.equal(removed.error, false, removed.text)
    })

    test('a permission prompt of the session shows on the page, and the answer there is the hook\'s', async () => {
        const stream = await eventStream(`${server.url}/api/outline/shop/${path.basename(file, '.md')}/events`)
        const answer = body => page(`/api/outline/shop/${path.basename(file, '.md')}/permission`, body)
        /** Runs the hook for a prompt, and waits until the page is shown it. */
        const ask = async () => {
            const hook = runHook(server, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' }, permission_mode: 'acceptEdits' })
            let prompts = []
            while (!prompts.length) prompts = JSON.parse((await stream.takeOf('permissions')).data)
            return { hook, prompt: prompts[0] }
        }
        const allowed = await ask()
        assert.deepEqual({ tool: allowed.prompt.tool, summary: allowed.prompt.summary, mode: allowed.prompt.mode }, { tool: 'Bash', summary: 'npm test', mode: 'acceptEdits' })
        assert.deepEqual(await (await answer({ id: allowed.prompt.id, answer: 'allow' })).json(), { ok: true })
        assert.deepEqual(JSON.parse(await allowed.hook), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
        // It is gone from the page, and cannot be answered twice.
        assert.deepEqual(JSON.parse((await stream.takeOf('permissions')).data), [])
        assert.deepEqual(await (await answer({ id: allowed.prompt.id, answer: 'deny' })).json(), { ok: false })

        const denied = await ask()
        await answer({ id: denied.prompt.id, answer: 'deny' })
        assert.deepEqual(JSON.parse(await denied.hook).hookSpecificOutput.decision, { behavior: 'deny', message: 'The user denied this on the outline page.' })

        // Dismissed, the prompt is the terminal's: the hook says nothing, and a message says where it waits.
        const dismissed = await ask()
        await answer({ id: dismissed.prompt.id, answer: 'dismiss' })
        assert.equal(await dismissed.hook, '')
        const notes = JSON.parse((await stream.takeOf('notes')).data)
        assert.match(notes.at(-1).html, /A permission prompt is waiting in the session.s terminal: <strong>Bash<\/strong> <code>npm test<\/code>/)
        assert.equal((await answer({ id: 'x', answer: 'maybe' })).status, 400)
        stream.close()
    })

    test('a session without an outline keeps its permission prompts to its terminal', async () => {
        const out = await new Promise(resolve => {
            const child = spawn(process.execPath, [path.join(PLUGIN, 'scripts', 'outline-hook.js')], { env: { ...process.env, HOME: server.home }, stdio: ['pipe', 'pipe', 'inherit'] })
            let text = ''
            child.stdout.on('data', d => (text += d))
            child.on('exit', () => resolve(text))
            child.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: '9a9a9a9a-0000-4000-8000-000000000000', cwd: '/nowhere', tool_name: 'Bash', tool_input: { command: 'ls' } }))
        })
        assert.equal(out, '')
    })

    test('what the user asked for in chat and the agent did is an action done: added with its outcome, or finished where it stands', async () => {
        const done = await mcp.tool('change', {
            ops: [
                { op: 'add', num: '2', title: 'Rollout', children: [{ title: 'Add a retry to the client', text: 'The user asked for it in chat.', outcome: 'Added, and its tests pass.' }, { title: 'Write the runbook' }] },
                { op: 'finish', num: '2.2', outcome: 'Written to docs/runbook.md.' },
                { op: 'add', num: '2.3', title: 'Deploy to staging', outcome: 'The deploy timed out.', failed: true },
            ],
        })
        assert.equal(done.error, false, done.text)
        assert.match(done.text, /2\.1 Add a retry to the client \[open, action done\]/)
        assert.match(done.text, /2\.3 Deploy to staging \[open, action failed\]/)
        const text = outlineText()
        assert.match(text, /^## 2\.1 @action-done Add a retry to the client\n\nThe user asked for it in chat\.\n\nAdded, and its tests pass\.$/m)
        assert.match(text, /^## 2\.2 @action-done Write the runbook\n\nWritten to docs\/runbook\.md\.$/m)
        assert.match(text, /^## 2\.3 @current @action-failed Deploy to staging\n\nThe deploy timed out\.$/m)
        // A question is answered by a pick, not finished; and an outcome has to say something.
        const question = await mcp.tool('change', { ops: [{ op: 'finish', num: '1.2', outcome: 'Done.' }] })
        assert.match(question.text, /1\.2 is a question: the user answers it by picking an option/)
        const empty = await mcp.tool('change', { ops: [{ op: 'add', num: '2.4', title: 'Tag the release', outcome: '' }] })
        assert.match(empty.text, /without its outcome/)
        assert.equal(outlineText(), text)
        assert.equal((await mcp.tool('change', { ops: [{ op: 'remove', num: '2' }] })).error, false)
    })

    test('a node is not finished as done while actions under it are unsettled', async () => {
        const built = await mcp.tool('change', {
            ops: [
                {
                    op: 'add',
                    num: '2',
                    title: 'Ship the retry',
                    action: 'Ships the retry.',
                    children: [
                        { title: 'Why it is needed', status: 'claim' },
                        { title: 'Run the tests', action: 'Runs the tests.' },
                        { title: 'Which rollout', text: 'Pick one of the options below.', options: [{ title: 'All at once', action: 'Rolls out to all.' }, { title: 'Canary first', action: 'Rolls out to a canary.' }] },
                    ],
                },
            ],
        })
        assert.equal(built.error, false, built.text)
        const before = outlineText()
        const refused = await mcp.tool('change', { ops: [{ op: 'finish', num: '2', outcome: 'Shipped.' }] })
        assert.equal(refused.error, true)
        // The claim and the options nobody picked are the user's; the action under it is the agent's to settle.
        assert.match(refused.text, /2 has an action under it that is not settled: 2\.2 Run the tests \(not run\)\./)
        assert.match(refused.text, /finish it with its outcome if you carried it out/)
        assert.equal(outlineText(), before)
        // An option the user picked is waiting to run, too.
        assert.equal((await act({ set: [{ num: '2.3.2', approved: true }] })).status, 200)
        const picked = await mcp.tool('change', { ops: [{ op: 'finish', num: '2.2', outcome: 'They fail.', failed: true }, { op: 'finish', num: '2', outcome: 'Shipped.' }] })
        assert.match(picked.text, /2 has actions under it that are not settled: 2\.2 Run the tests \(failed\); 2\.3\.2 \(B\) Canary first \(not run\)\./)
        // Settled in the same change: one finished, one given up. A finish as failed is never held back.
        const done = await mcp.tool('change', {
            ops: [{ op: 'finish', num: '2.2', outcome: 'They pass.' }, { op: 'update', num: '2.3.2', action: '', text: 'Not needed: the retry went out with the release.' }, { op: 'finish', num: '2', outcome: 'Shipped.' }],
        })
        assert.equal(done.error, false, done.text)
        assert.match(outlineText(), /^# 2\. @current @action-done Ship the retry$/m)
        assert.equal((await mcp.tool('change', { ops: [{ op: 'remove', num: '2' }] })).error, false)
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
            // Nothing is asked of the user before they write, and the file is named after an id, not a placeholder title.
            assert.match(opened.text, /Do not ask the user what they want to work on/)
            assert.match(opened.text, /Page: \S+\/\d{4}-\d\d-\d\d-[0-9a-f]{8}\n/)
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

    test('the queue holds what the agent puts in it: a task done is there to be read, and a task takes no approval', async () => {
        const n = (outlineText().match(/^# \d+\./gm) || []).length + 1
        const built = await mcp.tool('change', {
            ops: [
                { op: 'add', num: `${n}`, title: 'Results', children: [{ title: 'Add a retry', outcome: 'Added.' }, { title: 'Write the runbook', outcome: 'Written.' }, { title: 'Retries are safe', status: 'claim' }] },
                { op: 'queue', items: [{ num: `${n}.1` }, { num: `${n}.2`, read: true }] },
            ],
        })
        assert.equal(built.error, false, built.text)
        // Queued by the agent, a task done is an item to read, marked so or not.
        assert.match(outlineText(), new RegExp(`# @queue\\n- ${n}\\.1 @read Add a retry\\n- ${n}\\.2 @read Write the runbook\\n`))
        // Which nodes to ask the user about is the agent's choice: the server lists nothing else as waiting, not the claim either.
        assert.doesNotMatch(built.text, /Waiting on the user/)
        assert.doesNotMatch(built.text, /left out of the queue/)
        const text = outlineText()
        // An approval the user gives in chat cannot be recorded on a task, and a tick sent for one is not kept.
        const refused = await mcp.tool('change', { ops: [{ op: 'record', num: `${n}.1`, decision: 'approve' }] })
        assert.match(refused.text, new RegExp(`${n}\\.1 is a task, and a task takes no approval`))
        assert.equal((await act({ set: [{ num: `${n}.1`, approved: true }] })).status, 200)
        assert.equal(outlineText(), text)
        // Approving the parent approves the claim under it and passes over the tasks: nothing under it is left to approve.
        const all = await mcp.tool('change', { ops: [{ op: 'record', num: `${n}`, decision: 'approve' }] })
        assert.equal(all.error, false, all.text)
        assert.match(outlineText(), new RegExp(`^# ${n}\\. @user-approved @current Results$`, 'm'))
        assert.match(outlineText(), new RegExp(`^## ${n}\\.1 @action-done Add a retry$`, 'm'))
        assert.match(outlineText(), new RegExp(`^## ${n}\\.3 @user-approved @agent-claim Retries are safe$`, 'm'))
        assert.equal((await mcp.tool('change', { ops: [{ op: 'remove', num: `${n}` }] })).error, false)
    })

    test('a node is a claim or an action, never both: the change that would make it both is refused', async () => {
        const n = (outlineText().match(/^# \d+\./gm) || []).length + 1
        const built = await mcp.tool('change', { ops: [{ op: 'add', num: `${n}`, title: 'Kinds', children: [{ title: 'Retries are safe', status: 'claim' }, { title: 'Add a retry', action: 'Adds the retry.' }] }] })
        assert.equal(built.error, false, built.text)
        const text = outlineText()
        const refused = async ops => (await mcp.tool('change', { ops })).text
        assert.match(await refused([{ op: 'update', num: `${n}.1`, action: 'Adds the retry.' }]), /is a claim, so it cannot become an action too[\s\S]*add the action as a node of its own beside/)
        assert.match(await refused([{ op: 'update', num: `${n}.2`, status: 'claim' }]), /is an action, so it cannot be a claim too/)
        assert.match(await refused([{ op: 'finish', num: `${n}.1`, outcome: 'Done.' }]), /is a claim, so it is not finished as an action/)
        assert.match(await refused([{ op: 'add', num: `${n}.3`, title: 'Both', status: 'claim', action: 'Does it.' }]), /is added as a claim and as an action/)
        assert.equal(outlineText(), text)
        assert.equal((await mcp.tool('change', { ops: [{ op: 'remove', num: `${n}` }] })).error, false)
    })

    test('what the user does on a node is kept in the approval log, with the kind it had, and follows the node when numbers shift', async () => {
        const slug = path.basename(file, '.md')
        const history = async num => (await (await fetch(`${server.url}/api/outline/shop/${slug}/history?num=${num}`)).json()).flatMap(e => e.did ?? [])
        const n = (outlineText().match(/^# \d+\./gm) || []).length + 1
        const built = await mcp.tool('change', {
            ops: [{ op: 'add', num: `${n}`, title: 'Log', children: [{ title: 'Goes first' }, { title: 'Retries are safe', status: 'claim' }, { title: 'Add a retry', action: 'Adds the retry.' }] }],
        })
        assert.equal(built.error, false, built.text)
        // On the page: the claim approved, and the task run. A tick sent for the task is not an approval, and is not logged.
        assert.equal((await act({ set: [{ num: `${n}.2`, approved: true }, { num: `${n}.3`, approved: true }] })).status, 200)
        assert.equal((await act({ run: `${n}.3` })).status, 200)
        assert.deepEqual(await history(`${n}.2`), [{ what: 'approved', kind: 'claim' }])
        assert.deepEqual(await history(`${n}.3`), [{ what: 'ran', kind: 'action' }])
        // The agent finishes the task. The claim keeps its approval: it is another node.
        const finished = await mcp.tool('change', { ops: [{ op: 'finish', num: `${n}.3`, outcome: 'Added.' }] })
        assert.equal(finished.error, false, finished.text)
        assert.match(outlineText(), new RegExp(`^## ${n}\\.3 @current @action-done Add a retry$`, 'm'))
        assert.match(outlineText(), new RegExp(`^## ${n}\\.2 @user-approved @agent-claim Retries are safe$`, 'm'))
        // The user takes the claim back on the page.
        assert.equal((await act({ set: [{ num: `${n}.2`, approved: false }] })).status, 200)
        assert.deepEqual(await history(`${n}.2`), [{ what: 'approved', kind: 'claim' }, { what: 'took-back', kind: 'claim' }])
        // A node before them goes: the numbers shift, and each node's entries go with it.
        const removed = await mcp.tool('change', { ops: [{ op: 'remove', num: `${n}.1` }] })
        assert.equal(removed.error, false, removed.text)
        assert.deepEqual(await history(`${n}.2`), [{ what: 'ran', kind: 'action' }])
        assert.deepEqual((await history(`${n}.1`)).map(d => d.what), ['approved', 'took-back'])
        assert.equal((await mcp.tool('change', { ops: [{ op: 'remove', num: `${n}` }] })).error, false)
    })

    test('the outline keeps its workflow: the one the user names replaces it, a resumed or compacted session is told it', async () => {
        // The user names a workflow skill, and the agent passes it on.
        const named = await mcp.tool('start', { workflow: 'my-plugin:my-workflow' })
        assert.match(named.text, /Workflow skill of this outline: my-plugin:my-workflow\./)
        assert.match(outlineText(), /^Workflow: my-plugin:my-workflow$/m)
        // A later start that names none keeps it, and so does anything that is not a skill's name.
        assert.match((await mcp.tool('start', {})).text, /Workflow skill of this outline: my-plugin:my-workflow\./)
        assert.match((await mcp.tool('start', { workflow: 'not a skill name!' })).text, /Workflow skill of this outline: my-plugin:my-workflow\./)
        // After compaction the agent is told which one to load again.
        assert.match(await runHook(server, { hook_event_name: 'SessionStart', source: 'compact' }), /Workflow skill of this outline: my-plugin:my-workflow\. Load it if you do not have its text/)
        assert.equal((await mcp.tool('start', { workflow: 'outline-only:outline-workflow' })).error, false)
        assert.match(outlineText(), /^Workflow: outline-only:outline-workflow$/m)
    })

    test('the outline keeps its Mode and Workflow lines through every change', () => {
        assert.match(outlineText(), /^Title: [^\n]*\n(?:[A-Z][a-z]+: [^\n]*\n)*Mode: server\nWorkflow: outline-only:outline-workflow\n\n/)
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
