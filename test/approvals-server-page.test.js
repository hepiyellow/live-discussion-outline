import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { SESSION, inServerMode, launchBrowser, startServer, until } from './helpers.js'

// Server mode. A tick, a pick and a press of Run are recorded in the outline at once: the page tells the server, which
// writes the file and keeps the news for the agent. Nothing is typed into the session for an approval. sample.md names
// a terminal that does not exist, so a run is kept for the agent like the rest.

/** Clicks an element in the middle of the window: scrolled just into view, it would sit under the sticky headers. */
const click = async locator => {
    await locator.evaluate(e => e.scrollIntoView({ block: 'center' }))
    await locator.click()
}

describe('approvals, picks, runs and undo in server mode', () => {
    let server, browser, page, sent
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    beforeEach(async () => {
        server.swap('demo/sample', 'demo/sample', 'server')
        server.resetState()
        fs.rmSync(path.join(server.dir, '.ledger'), { recursive: true, force: true })
        sent = []
        page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
        await page.route('**/send', async route => {
            sent.push(route.request().postDataJSON())
            await route.fulfill({ status: 200, body: 'sent' })
        })
        const errors = []
        page.on('pageerror', e => errors.push(e))
        page.checkErrors = () => {
            if (errors.length) throw errors[0]
        }
        await page.goto(`${server.url}/demo/sample`)
        await page.locator('[data-topbar] [data-title]').waitFor()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const node = num => page.locator(`.outline-tab [data-num="${num}"]`)
    const box = num => ({ click: () => click(node(num).locator('> .ck')), getAttribute: name => node(num).locator('> .ck').getAttribute(name) })
    const state = num => box(num).getAttribute('data-state')
    /** The button in an option's text that picks it. */
    const pick = num => node(num).locator('> .pick-line [data-pick]')
    /** A node's kind mark (null when it has none: at its left, or on a parent first among the bubbles at its right), and the kind marks found under a parent. */
    const mark = num => node(num).evaluate(el => el.querySelector(':scope > .marks .km[data-own]')?.dataset.kind ?? null)
    /** The columns of the kinds under a parent, in the order they are drawn: a claim you approved is its own column. */
    const below = num => node(num).locator('.extras .km:not([data-own])').evaluateAll(els => els.map(e => e.dataset.key))
    /** Waits until a topic or parent shows open or collapsed. */
    const expanded = (num, want) => page.waitForFunction(([n, w]) => document.querySelector(`.outline-tab [data-num="${n}"]`).getAttribute('aria-expanded') === w, [num, String(want)])
    /** Opens a topic or parent the page shows collapsed (one whose nodes are all settled starts that way). */
    const expand = async num => {
        if ((await node(num).getAttribute('aria-expanded')) === 'false') await node(num).locator('.node-title').click()
        await expanded(num, true)
    }
    /** Waits until a node's box shows `want`. */
    const shows = (num, want) => until(async () => (await state(num)) === want, { what: `${num} to show ${want}` })
    const file = () => fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8')
    const heading = num => file().split('\n').find(line => new RegExp(`^#+ ${num.replaceAll('.', '\\.')}\\.? `).test(line))
    /** A change the agent makes through its tools. */
    const change = async ops =>
        (await fetch(`${server.url}/api/agent/change`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outline-agent': '1' }, body: JSON.stringify({ session: SESSION, ops }) })).json()
    /** What the agent is told with the user's next prompt (the plugin's hook asks for it). */
    const told = async () =>
        (await (await fetch(`${server.url}/api/agent/pending`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outline-agent': '1' }, body: JSON.stringify({ session: SESSION }) })).json()).text

    test('ticking an open node records the approval in the outline at once', async () => {
        await box('3.3').click()
        await shows('3.3', 'pending')
        assert.equal(heading('3.3'), '## 3.3 @user-approved Who can flush the cache by hand')
        // The agent learns of it with the user's next prompt; nothing is typed into its session.
        assert.match(await told(), /the user:\n- approved 3\.3 Who can flush the cache by hand\n/)
        assert.equal(await told(), '')
        assert.deepEqual(sent, [])
    })

    test('a click on a claim approves it, and the claim stays under the approval', async () => {
        // Nothing is queued in server mode, and the box says so.
        assert.equal(await box('2.3').getAttribute('title'), 'Claim — click to approve it')
        await box('2.3').click()
        await shows('2.3', 'pending')
        assert.equal(heading('2.3'), '## 2.3 @user-approved @agent-claim Cache key')
        // The node's history says what the user did, and what it was they approved.
        await node('2.3').hover()
        await node('2.3').getByRole('button', { name: 'History of 2.3' }).click()
        await page.getByRole('dialog').getByText('You approved this claim').waitFor()
    })

    test('picking an option answers its question and collapses it', async () => {
        assert.equal((await pick('2.1.1').textContent()).trim(), 'Pick this option')
        assert.equal(await node('2.1.1').locator('.pick-what').textContent(), 'Answers 2.1 with this option.')
        await click(pick('2.1.1'))
        await shows('2.1.1', 'pending')
        assert.equal(await state('2.1.2'), 'open')
        assert.equal(heading('2.1.1'), '### 2.1.1 @user-approved @option_A In each service instance')
        assert.equal(heading('2.1'), '## 2.1 @user-approved @options Cache placement')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.1"]').getAttribute('aria-expanded') === 'false')
        assert.equal(await state('2.1'), 'pending')
        assert.match(await told(), /- picked 2\.1\.1 \(A\) In each service instance\n/)
    })

    test('the question’s own box picks the recommended option', async () => {
        await box('2.1').click()
        await shows('2.1', 'pending')
        assert.equal(heading('2.1.2'), '### 2.1.2 @user-approved @recommended @option_B A shared Redis cluster')
    })

    test('the pick moves to another option, and a click on a picked option takes it back', async () => {
        await click(pick('2.1.1'))
        await shows('2.1.1', 'pending')
        // The picked option says so in its button and, for when its row is closed, with a tick at the right of its row.
        assert.equal((await pick('2.1.1').textContent()).trim(), 'Picked')
        assert.equal(await node('2.1.1').locator('> .marks .pick-tick').count(), 1)
        assert.equal(await node('2.1.2').locator('> .marks .pick-tick').count(), 0)
        assert.equal(await node('2.1.2').locator('.pick-what').textContent(), 'Answers 2.1 with this option instead of (A).')
        await expanded('2.1', false)
        await expand('2.1')
        await click(pick('2.1.2'))
        await until(async () => heading('2.1.2') === '### 2.1.2 @user-approved @recommended @option_B A shared Redis cluster', { what: 'the pick to move to 2.1.2' })
        assert.equal(heading('2.1.1'), '### 2.1.1 @option_A In each service instance')
        await until(async () => (await node('2.1.1').locator('> .marks .pick-tick').count()) === 0, { what: 'the tick of 2.1.1 to go' })
        // Picked, an option's text closes like any node the user approved: its button is in it.
        await expand('2.1.2')
        assert.equal((await pick('2.1.2').textContent()).trim(), 'Picked')
        assert.equal(await node('2.1.2').locator('.pick-what').textContent(), 'Your answer to 2.1. A click takes it back.')
        await click(pick('2.1.2'))
        await until(async () => heading('2.1.2') === '### 2.1.2 @recommended @option_B A shared Redis cluster', { what: 'the pick to be taken back' })
        assert.equal(heading('2.1'), '## 2.1 @options Cache placement')
    })

    test('an option that is a task is picked first: its Run button is off until then, and points at the pick button', async () => {
        const added = await change([{ op: 'add', num: '3.4', title: 'How to roll out', text: 'Pick one of the options below.', options: [{ title: 'Canary first', task: 'Roll out to one instance.' }, { title: 'All at once' }] }])
        assert.equal(added.ok, true)
        // An option just added is a bare row, with no button to pick what the user has not seen.
        await node('3.4').locator('> .env').waitFor()
        await node('3.4').locator('> .env').click()
        await pick('3.4.1').waitFor()
        const run = node('3.4.1').locator('[data-run]')
        await until(async () => (await run.getAttribute('aria-disabled')) === 'true', { what: 'the Run button of 3.4.1 to be off' })
        assert.equal(await run.getAttribute('title'), 'Pick this option first: click to see its button')
        // Off, it still takes the click (Playwright does not click what says it is disabled, so the click is forced).
        await run.click({ force: true })
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.4.1"] [data-pick]').hasAttribute('data-pulse'))
        assert.equal(await told(), '')
        await click(pick('3.4.1'))
        await until(async () => /^### 3\.4\.1 @user-approved /.test(heading('3.4.1') ?? ''), { what: '3.4.1 to be picked' })
        // The pick runs nothing: the button is on now, and the task waits for it.
        await until(async () => (await run.getAttribute('aria-disabled')) === 'false', { what: 'the Run button of 3.4.1 to be on' })
        assert.doesNotMatch(await told(), /pressed Run/)
    })

    test('the Action tag is the button that runs the action, then waits', async () => {
        const play = node('2.4').locator('.closing [data-run]')
        await click(play)
        await node('2.4').locator('[data-run-sent]').waitFor()
        // No session terminal to type into: the agent is told with the user's next prompt.
        assert.match(await told(), /- pressed Run on 2\.4 Measure the hit rate on staging: carry it out now/)
        await play.click()
        await page.waitForTimeout(300)
        assert.equal(await told(), '')
        // A node already run has no button.
        assert.equal(await node('2.5').locator('[data-run]').count(), 0)
        // Once the agent finishes it, the run request is forgotten.
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        fs.writeFileSync(path.join(server.dir, 'demo', 'sample.md'), file().replace('## 2.4 @action Measure', '## 2.4 @action-done Measure'))
        // The change waits to be opened, and the outline does not move: 2.4 keeps the tag of an action proposed, and
        // the topic over it stays open.
        await node('2.4').locator('> .env').waitFor()
        assert.equal(await node('2').getAttribute('aria-expanded'), 'true')
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Action'])
        // Opening the change turns its Action tag into Done. With that, nothing under the topic is open any more:
        // once the change has been shown, the topic collapses. Its box rolls up approvals only, and the user approved
        // some of what is under it.
        await node('2.4').locator('> .env').click()
        await expanded('2', false)
        assert.equal(await state('2'), 'mixed')
        await expand('2')
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Done'])
        // The Action line says it: no second tag on the title.
        assert.equal(await node('2.4').locator('.node-title .pill-done').count(), 0)
        await until(async () => !(await (await fetch(`${server.url}/api/state/demo/sample`)).json()).runs['2.4'], { what: 'the run request to end' })
    })

    test('undo takes the approval back', async () => {
        await box('3.3').click()
        await shows('3.3', 'pending')
        await page.getByRole('button', { name: 'Undo your last approval' }).click()
        await shows('3.3', 'open')
        assert.equal(heading('3.3'), '## 3.3 Who can flush the cache by hand')
        assert.equal(await page.getByRole('button', { name: 'Undo your last approval' }).isDisabled(), true)
        // Ticked and unticked before the agent was told: it hears only where the node ended up.
        assert.match(await told(), /- took their approval back from 3\.3 Who can flush the cache by hand\n/)
    })

    test('undo over mixed children puts each back as it was', async () => {
        await box('3').click()
        await shows('3', 'pending')
        assert.equal(heading('3'), '# 3. @user-approved Invalidation')
        // ⌘Z (Ctrl+Z) undoes too.
        await page.keyboard.press('Control+z')
        await shows('3', 'open')
        // A claim the user approved is a claim again: its box is empty, and its kind mark was the claim's all along.
        assert.equal(await state('3.2'), 'open')
        assert.equal(await mark('3.2'), 'claim')
        assert.equal(await state('3.3'), 'open')
        assert.equal(heading('3'), '# 3. Invalidation')
    })

    test('a tick that leaves nothing open in a parent collapses it, and undo opens it again', async () => {
        // 2.4 is the one open node of its topic: the rest are claims, an answered question and a done action.
        assert.equal(await state('2'), 'mixed')
        await box('2.4').click()
        await expanded('2', false)
        // Settled, its box still says that the user approved only some of what is under it.
        assert.equal(await state('2'), 'mixed')
        await page.keyboard.press('Control+z')
        await expanded('2', true)
        await shows('2', 'mixed')
    })

    test('a parent whose nodes are all claims starts collapsed, with an empty box and the claim mark beside it; a click on the box approves them', async () => {
        assert.equal(await node('4').getAttribute('aria-expanded'), 'false')
        assert.equal(await state('4'), 'open')
        assert.deepEqual(await below('4'), ['claim'])
        await box('4').click()
        await until(async () => heading('4.2') === '## 4.2 @user-approved @agent-claim Start with internal tenants', { what: 'the claims of 4 to be approved' })
        assert.equal(heading('4.1'), '## 4.1 @user-approved @agent-claim Behind a feature flag per tenant')
    })

    test('an approval is pending, fading out and in, until the agent acknowledges it; then it is a still, green outlined tick', async () => {
        const drawn = () => node('4.1').locator('> .ck').evaluate(e => (({ animationName, backgroundColor }) => ({ animationName, backgroundColor }))(getComputedStyle(e)))
        await expand('4')
        await box('4.1').click()
        // Recorded at once, and pending on the page all the same.
        await shows('4.1', 'pending')
        assert.equal(heading('4.1'), '## 4.1 @user-approved @agent-claim Behind a feature flag per tenant')
        assert.deepEqual(await drawn(), { animationName: 'ckpending', backgroundColor: 'rgba(0, 0, 0, 0)' })
        assert.match(await box('4.1').getAttribute('title'), /pending until the agent acknowledges it/)
        // A change the agent made before it was told of the tick does not acknowledge it.
        assert.equal((await change([{ op: 'acknowledge' }])).ok, true)
        await page.waitForTimeout(200)
        assert.equal(await state('4.1'), 'pending')
        // That change's result told the agent; its next change acknowledges, whatever it holds.
        assert.equal((await change([{ op: 'acknowledge' }])).ok, true)
        await shows('4.1', 'approved')
        assert.deepEqual(await drawn(), { animationName: 'none', backgroundColor: 'rgba(0, 0, 0, 0)' })
        // An approval taken back waits for the agent the same way: the box, a claim again, fades until it is acknowledged.
        await box('4.1').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="4.1"] > .ck').hasAttribute('data-waiting'))
        assert.equal(await state('4.1'), 'open')
        assert.equal(await mark('4.1'), 'claim')
        assert.match(await told(), /took their approval back from 4\.1/)
        assert.equal((await change([{ op: 'acknowledge' }])).ok, true)
        await page.waitForFunction(() => !document.querySelector('.outline-tab [data-num="4.1"] > .ck').hasAttribute('data-waiting'))
        // Approvals are the outline's, not the viewer's: the viewer state's file-mode sections stay empty.
        const { overrides, sent, backTo } = await (await fetch(`${server.url}/api/state/demo/sample`)).json()
        assert.deepEqual({ overrides, sent, backTo }, { overrides: {}, sent: {}, backTo: {} })
    })

    test('a decide item stays one only while the agent recommends nothing for it', async () => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        // 3.3 is open with no recommendation; 3.2 holds a recommendation; 2.2 is a question already answered.
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# @queue\n', '# @queue\n- 3.3 @decide Who may flush.\n- 3.2 @decide How long entries live.\n'))
        const kind = num => page.locator(`[data-queue="${num}"]`).getAttribute('data-kind')
        await page.locator('[data-queue="3.3"]').waitFor()
        assert.deepEqual([await kind('3.3'), await kind('3.2'), await kind('2.1')], ['decide', 'approve', 'approve'])
    })

    test('the action indicator of an action runs nothing: it opens the node and points at the button that does', async () => {
        await node('2.4').locator('> .node-title').click()
        await node('2.4').locator('.closing [data-run]').waitFor({ state: 'hidden' })
        await click(node('2.4').locator('> .marks [data-point]'))
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"] [data-run]').hasAttribute('data-pulse'))
        assert.equal(await node('2.4').locator('.closing [data-run]').isVisible(), true)
        assert.equal(await node('2.4').locator('[data-run-sent]').count(), 0)
        assert.equal(await told(), '')
    })

    test('a failed action says so, and can be run again', async () => {
        const target = path.join(server.dir, 'demo', 'sample.md')
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        await click(node('2.4').locator('.closing [data-run]'))
        await node('2.4').locator('[data-run-sent]').waitFor()
        await told()
        fs.writeFileSync(target, file().replace('## 2.4 @action Measure', '## 2.4 @action-failed Measure'))
        // The request has ended: the ring is gone, and the change waits to be opened.
        await node('2.4').locator('[data-run-sent]').waitFor({ state: 'detached' })
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('.closing .pill-failed').waitFor()
        await page.locator('.tx-cur').waitFor({ state: 'detached' })
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Failed', 'Run again'])
        // Still in the queue, and it can be run again.
        assert.equal(await page.locator('[data-queue="2.4"]').count(), 1)
        await click(node('2.4').locator('.closing [data-run]'))
        await until(async () => /pressed Run on 2\.4/.test(await told()), { what: 'the second run request' })
    })

    test('a queue item opens its node when the node has nodes under it', async () => {
        await page.getByRole('button', { name: 'Collapse all' }).click()
        assert.equal(await node('2.1').isVisible(), false)
        await page.locator('[data-queue="2.1"]').click()
        // The question is shown, and so are its options: they are what there is to pick from.
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.1"]').hasAttribute('data-qmark'))
        assert.equal(await node('2.1.1').isVisible(), true)
        assert.equal(await node('2.1.2').isVisible(), true)
    })

    test('a done action has the filled yellow triangle as its kind mark and an empty box, which a click ticks; approved, it has both', async () => {
        assert.equal(await mark('2.5'), 'done')
        assert.equal(await state('2.5'), 'open')
        assert.equal(await box('2.5').getAttribute('title'), 'Done: the agent carried out this action — click to approve it')
        assert.equal((await below('2')).includes('done'), true)
        await box('2.5').click()
        await shows('2.5', 'pending')
        assert.equal(heading('2.5'), '## 2.5 @user-approved @action-done Add cache metrics to the dashboard')
        // Once the agent has the approval, the box is the user's tick, and the kind mark still says done.
        assert.equal((await change([{ op: 'acknowledge' }])).ok, true)
        assert.equal((await change([{ op: 'acknowledge' }])).ok, true)
        await shows('2.5', 'approved')
        assert.equal(await mark('2.5'), 'done')
        assert.equal(await box('2.5').getAttribute('title'), 'Done: the agent carried out this action, and you approved it')
        assert.equal((await below('2')).includes('done'), true)
        // A click takes the approval back, as on any approved node.
        await box('2.5').click()
        await until(async () => heading('2.5') === '## 2.5 @action-done Add cache metrics to the dashboard', { what: 'the approval of 2.5 to be taken back' })
    })

    test('a local command run in the session shows in the inbox as it happens, with its name and output', async () => {
        const transcript = path.join(server.home, '.claude', 'projects', '-home-dev-search', `${SESSION}.jsonl`)
        const original = fs.readFileSync(transcript, 'utf8')
        try {
            // Claude Code runs it without a turn of the agent: only the transcript shows it.
            const at = new Date().toISOString()
            const entries = [
                { type: 'system', subtype: 'local_command', uuid: 'c-1', timestamp: at, content: '<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>' },
                { type: 'system', subtype: 'local_command', uuid: 'c-2', timestamp: at, content: '<local-command-stdout>\u001b[1mContext Usage\u001b[22m ⛁ ⛁</local-command-stdout>' },
                { type: 'user', isMeta: true, uuid: 'c-3', timestamp: at, message: { role: 'user', content: '## Context Usage\n\n**Tokens:** 12k / 1m' } },
            ]
            fs.appendFileSync(transcript, entries.map(e => `${JSON.stringify({ sessionId: SESSION, ...e })}\n`).join(''))
            await page.getByRole('button', { name: 'Messages from the agent' }).click()
            const message = page.locator('[data-read], [data-message], li, article').filter({ hasText: '12k / 1m' }).first()
            await message.waitFor()
            assert.match(await message.textContent(), /\/context/)
            assert.match(await message.textContent(), /Context Usage/)
        } finally {
            fs.writeFileSync(transcript, original)
        }
    })

    test('a permission prompt of the session pops up: Allow answers it, closing it leaves it to the terminal', async () => {
        /** The session's PermissionRequest hook asks the server, and waits for the answer. */
        const ask = input =>
            fetch(`${server.url}/api/agent/permission`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outline-agent': '1' }, body: JSON.stringify({ session: SESSION, tool: 'Bash', input, mode: 'acceptEdits' }) }).then(r => r.json())
        const popup = page.locator('[data-permission]')
        const first = ask({ command: 'npm run deploy', description: 'Deploy to staging' })
        await popup.waitFor()
        assert.match(await popup.textContent(), /Allow Bash\?/)
        assert.match(await popup.textContent(), /npm run deploy/)
        assert.match(await popup.locator('[data-permission-input]').textContent(), /"description": "Deploy to staging"/)
        await popup.getByRole('button', { name: 'Allow' }).click()
        assert.deepEqual(await first, { ok: true, decision: 'allow', message: '' })
        await popup.waitFor({ state: 'detached' })

        // Closed without an answer, the prompt is the terminal's, and the inbox says so.
        const second = ask({ command: 'rm -rf build' })
        await popup.waitFor()
        await page.keyboard.press('Escape')
        assert.deepEqual(await second, { ok: true, decision: '', message: '' })
        await popup.waitFor({ state: 'detached' })
        await page.getByRole('button', { name: 'Messages from the agent' }).click()
        await page.getByText('A permission prompt is waiting in the session').first().waitFor()

        // Answered in the terminal, it goes by itself: the transcript gets the tool call's result.
        const transcript = path.join(server.home, '.claude', 'projects', '-home-dev-search', `${SESSION}.jsonl`)
        const original = fs.readFileSync(transcript, 'utf8')
        try {
            await page.keyboard.press('Escape')
            const input = { command: 'git push' }
            fs.appendFileSync(transcript, `${JSON.stringify({ sessionId: SESSION, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_push', name: 'Bash', input }] } })}\n`)
            const third = ask(input)
            await popup.waitFor()
            fs.appendFileSync(transcript, `${JSON.stringify({ sessionId: SESSION, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_push', content: 'pushed' }] } })}\n`)
            assert.deepEqual(await third, { ok: true, decision: '', message: '' })
            await popup.waitFor({ state: 'detached' })
        } finally {
            fs.writeFileSync(transcript, original)
        }
    })

    test('queue items hide once handled here, and open their node', async () => {
        const queued = () => page.locator('[aria-label="Your queue"] [data-queue]').evaluateAll(els => els.map(e => e.dataset.queue))
        assert.deepEqual(await queued(), ['2.1', '2.4', '2.3', '3.1.1.1.1.1'])
        // Each node shows its item's icon left of its checkbox, as the left pane does; an action's is its triangle.
        const icon = num => node(num).locator('> .qicon').evaluateAll(els => els.map(e => e.dataset.queueKind))
        // The agent queued 2.1 to decide, but it recommends one of its options: that is something to approve.
        assert.deepEqual([await icon('2.1'), await icon('2.3'), await icon('3.1.1.1.1.1'), await icon('2.4')], [['approve'], ['approve'], ['read'], []])
        assert.equal(await page.locator('[data-queue="2.1"]').getAttribute('data-kind'), 'approve')
        assert.equal(await node('2.4').locator('> .play').count(), 1)
        await box('2.3').click()
        await box('2.1.2').click()
        await until(async () => (await queued()).join() === '2.4,3.1.1.1.1.1', { what: 'the handled items to leave the queue' })
        // The server dropped them from the outline's queue too.
        assert.match(file(), /# @queue\n- 2\.4 @run [^\n]*\n- 3\.1\.1\.1\.1\.1 @read [^\n]*\n$/)
        // Handled here: the icon goes with the item.
        assert.deepEqual([await icon('2.1'), await icon('2.3')], [[], []])
        await click(node('2.4').locator('.closing [data-run]'))
        await page.waitForFunction(() => !document.querySelector('[data-queue="2.4"]'))
        await page.getByRole('button', { name: 'Collapse all' }).click()
        await page.locator('[data-queue="3.1.1.1.1.1"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1.1.1.1"]').hasAttribute('data-qmark'))
        assert.equal(await node('3.1.1.1.1.1').isVisible(), true)
        // A read item has nothing to tick: a click on the eye beside its node marks it read, and it leaves the queue.
        assert.match(await node('3.1.1.1.1.1').locator('> .qicon').getAttribute('title'), /click to mark it read/)
        await node('3.1.1.1.1.1').locator('> .qicon').click()
        await page.locator('[data-queue="3.1.1.1.1.1"]').waitFor({ state: 'detached' })
        assert.equal(await node('3.1.1.1.1.1').locator('> .qicon').count(), 0)
        // It stays read across a reload.
        await page.reload()
        await page.locator('[data-topbar] [data-title]').waitFor()
        await page.locator('.outline-tab').waitFor()
        await page.waitForTimeout(400)
        assert.equal(await page.locator('[data-queue="3.1.1.1.1.1"]').count(), 0)
    })
})

describe('approvals in server mode without a linked session', () => {
    let server, browser, page
    before(async () => {
        server = await startServer()
        const text = fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8').replace(/^Terminal: .*\n/m, '')
        fs.writeFileSync(path.join(server.dir, 'demo', 'unlinked.md'), inServerMode(text))
        browser = await launchBrowser()
        const context = await browser.newContext()
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        page = await context.newPage()
        await page.goto(`${server.url}/demo/unlinked`)
        await page.locator('[data-topbar] [data-title]').waitFor()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })

    test('a tick is recorded the same way: nothing to copy', async () => {
        await click(page.locator('.outline-tab [data-num="3.3"] > .ck'))
        await until(async () => /^## 3\.3 @user-approved /m.test(fs.readFileSync(path.join(server.dir, 'demo', 'unlinked.md'), 'utf8')), { what: 'the approval in the outline' })
        assert.equal(await page.getByRole('region', { name: 'Approvals to copy' }).count(), 0)
    })

    test('the reference button copies a reference', async () => {
        const ref = page.locator('.outline-tab [data-num="3.2"]')
        await ref.evaluate(e => e.scrollIntoView({ block: 'center' }))
        await ref.hover()
        await ref.locator('.ask').first().click()
        const expected = 'Re: outline "Caching for the search service" › 3. Invalidation › 3.2 Time to live — '
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === expected, { what: 'the reference on the clipboard' })
    })
})
