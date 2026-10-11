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
    /** Waits until a node's box shows `want`. */
    const shows = (num, want) => until(async () => (await state(num)) === want, { what: `${num} to show ${want}` })
    const file = () => fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8')
    const heading = num => file().split('\n').find(line => new RegExp(`^#+ ${num.replaceAll('.', '\\.')}\\.? `).test(line))
    /** What the agent is told with the user's next prompt (the plugin's hook asks for it). */
    const told = async () =>
        (await (await fetch(`${server.url}/api/agent/pending`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-outline-agent': '1' }, body: JSON.stringify({ session: SESSION }) })).json()).text

    test('ticking an open node records the approval in the outline at once', async () => {
        await box('2.4').click()
        await shows('2.4', 'approved')
        assert.equal(heading('2.4'), '## 2.4 @user-approved @action Measure the hit rate on staging')
        // The agent learns of it with the user's next prompt; nothing is typed into its session.
        assert.match(await told(), /the user:\n- approved 2\.4 Measure the hit rate on staging\n/)
        assert.equal(await told(), '')
        assert.deepEqual(sent, [])
    })

    test('a click on a claim approves it, and the claim stays under the approval', async () => {
        // Nothing is queued in server mode, and the box says so.
        assert.equal(await box('2.3').getAttribute('title'), 'Claim — click to approve it')
        await box('2.3').click()
        await shows('2.3', 'approved')
        assert.equal(heading('2.3'), '## 2.3 @user-approved @agent-claim Cache key')
    })

    test('picking an option answers its question and collapses it', async () => {
        await box('2.1.1').click()
        await shows('2.1.1', 'approved')
        assert.equal(await state('2.1.2'), 'open')
        assert.equal(heading('2.1.1'), '### 2.1.1 @user-approved @option_A In each service instance')
        assert.equal(heading('2.1'), '## 2.1 @user-approved @options Cache placement')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.1"]').getAttribute('aria-expanded') === 'false')
        assert.equal(await state('2.1'), 'approved')
        assert.match(await told(), /- picked 2\.1\.1 \(A\) In each service instance\n/)
    })

    test('the question’s own box picks the recommended option', async () => {
        await box('2.1').click()
        await shows('2.1', 'approved')
        assert.equal(heading('2.1.2'), '### 2.1.2 @user-approved @recommended @option_B A shared Redis cluster')
    })

    test('play asks the agent to run the action, then waits', async () => {
        const play = node('2.4').locator('.play')
        await click(play)
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        // No session terminal to type into: the agent is told with the user's next prompt.
        assert.match(await told(), /- pressed Run on 2\.4 Measure the hit rate on staging: carry it out now/)
        await play.click()
        await page.waitForTimeout(300)
        assert.equal(await told(), '')
        // A node already run has no play button.
        assert.equal(await node('2.5').locator('.play').count(), 0)
        // Once the agent finishes it, the run request is forgotten.
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        fs.writeFileSync(path.join(server.dir, 'demo', 'sample.md'), file().replace('## 2.4 @action Measure', '## 2.4 @action-done Measure'))
        // The node has changed: its play button goes, and opening the change turns its Action tag into Done.
        await node('2.4').locator('> .env').waitFor()
        assert.equal(await node('2.4').locator('.play').count(), 0)
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Action'])
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('.closing .pill-done').waitFor()
        await page.locator('.tx-cur').waitFor({ state: 'detached' })
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Done'])
        // The Action line says it: no second tag on the title.
        assert.equal(await node('2.4').locator('.node-title .pill-done').count(), 0)
        await until(async () => !(await (await fetch(`${server.url}/api/state/demo/sample`)).json()).runs['2.4'], { what: 'the run request to end' })
    })

    test('undo takes the approval back', async () => {
        await box('2.4').click()
        await shows('2.4', 'approved')
        await page.getByRole('button', { name: 'Undo your last approval' }).click()
        await shows('2.4', 'open')
        assert.equal(heading('2.4'), '## 2.4 @action Measure the hit rate on staging')
        assert.equal(await page.getByRole('button', { name: 'Undo your last approval' }).isDisabled(), true)
        // Ticked and unticked before the agent was told: it hears only where the node ended up.
        assert.match(await told(), /- took their approval back from 2\.4 Measure the hit rate on staging\n/)
    })

    test('undo over mixed children puts each back as it was', async () => {
        await box('3').click()
        await shows('3', 'approved')
        assert.equal(heading('3'), '# 3. @user-approved Invalidation')
        // ⌘Z (Ctrl+Z) undoes too.
        await page.keyboard.press('Control+z')
        await shows('3', 'mixed')
        // A claim the user approved is a claim again.
        assert.equal(await state('3.2'), 'claim')
        assert.equal(await state('3.3'), 'open')
        assert.equal(heading('3'), '# 3. Invalidation')
    })

    test('completing a parent collapses it, and undo opens it again', async () => {
        await box('4.1').click()
        await box('4.2').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="4"]').getAttribute('aria-expanded') === 'false')
        await page.keyboard.press('Control+z')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="4"]').getAttribute('aria-expanded') === 'true')
    })

    test('an approval is drawn as a still, green outlined tick', async () => {
        await box('4.1').click()
        await shows('4.1', 'approved')
        const drawn = await node('4.1').locator('> .ck').evaluate(e => (({ animationName, backgroundColor }) => ({ animationName, backgroundColor }))(getComputedStyle(e)))
        assert.deepEqual(drawn, { animationName: 'none', backgroundColor: 'rgba(0, 0, 0, 0)' })
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
        assert.deepEqual(await node('3.3').locator('> .qicon').evaluateAll(els => els.map(e => e.dataset.queueKind)), ['decide'])
    })

    test('a failed action says so, and can be run again', async () => {
        const target = path.join(server.dir, 'demo', 'sample.md')
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        await click(node('2.4').locator('.play'))
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        await told()
        fs.writeFileSync(target, file().replace('## 2.4 @action Measure', '## 2.4 @action-failed Measure'))
        // The request has ended: the play button is back, and the change waits to be opened.
        await page.waitForFunction(() => !document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('.closing .pill-failed').waitFor()
        await page.locator('.tx-cur').waitFor({ state: 'detached' })
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Failed'])
        // Still in the queue, and it can be run again.
        assert.equal(await page.locator('[data-queue="2.4"]').count(), 1)
        await click(node('2.4').locator('.play'))
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

    test('a done action shows a filled yellow tick, which a click turns into an approval', async () => {
        assert.equal(await state('2.5'), 'done')
        await box('2.5').click()
        await shows('2.5', 'approved')
        assert.equal(heading('2.5'), '## 2.5 @user-approved @action-done Add cache metrics to the dashboard')
    })

    test('queue items hide once handled here, and open their node', async () => {
        const queued = () => page.locator('[aria-label="Your queue"] [data-queue]').evaluateAll(els => els.map(e => e.dataset.queue))
        assert.deepEqual(await queued(), ['2.1', '2.4', '2.3', '3.1.1.1.1.1'])
        // Each node shows its item's icon left of its checkbox, as the left pane does; an action's is its play button.
        const icon = num => node(num).locator('> .qicon').evaluateAll(els => els.map(e => e.dataset.queueKind))
        // The agent queued 2.1 to decide, but it recommends one of its options: that is something to approve.
        assert.deepEqual([await icon('2.1'), await icon('2.3'), await icon('3.1.1.1.1.1'), await icon('2.4')], [['approve'], ['approve'], ['read'], []])
        assert.equal(await page.locator('[data-queue="2.1"]').getAttribute('data-kind'), 'approve')
        assert.equal(await node('2.4').locator('> .play').count(), 1)
        await box('2.3').click()
        await box('2.1.2').click()
        await until(async () => (await queued()).join() === '2.4,3.1.1.1.1.1', { what: 'the handled items to leave the queue' })
        // The server dropped them from the outline's queue too.
        assert.match(file(), /# @queue\n- 2\.4 @action [^\n]*\n- 3\.1\.1\.1\.1\.1 @read [^\n]*\n$/)
        // Handled here: the icon goes with the item.
        assert.deepEqual([await icon('2.1'), await icon('2.3')], [[], []])
        await click(node('2.4').locator('.play'))
        await page.waitForFunction(() => !document.querySelector('[data-queue="2.4"]'))
        await page.getByRole('button', { name: 'Collapse all' }).click()
        await page.locator('[data-queue="3.1.1.1.1.1"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1.1.1.1"]').hasAttribute('data-qmark'))
        assert.equal(await node('3.1.1.1.1.1').isVisible(), true)
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
        await click(page.locator('.outline-tab [data-num="2.4"] > .ck'))
        await until(async () => /^## 2\.4 @user-approved @action /m.test(fs.readFileSync(path.join(server.dir, 'demo', 'unlinked.md'), 'utf8')), { what: 'the approval in the outline' })
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
