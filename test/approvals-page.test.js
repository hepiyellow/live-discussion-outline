import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, openPage, startServer, until } from './helpers.js'

// File mode: the agent writes the outline's file, so the page tells it in its session what the user ticked, and the tick
// is pending until the agent records it. (Server mode's ticks are in approvals-server-page.test.js.)
// sample.md names a terminal, so the page sends its messages through /send. The tests answer /send themselves and
// record what the page sent: no tmux needed.

/** Clicks an element in the middle of the window: scrolled just into view, it would sit under the sticky headers. */
const click = async locator => {
    await locator.evaluate(e => e.scrollIntoView({ block: 'center' }))
    await locator.click()
}

describe('approvals, picks, runs and undo in file mode', () => {
    let server, browser, page, sent, read
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    beforeEach(async () => {
        server.swap('demo/sample', 'demo/sample')
        server.resetState()
        sent = []
        read = 0
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
    /** The next message the page sent (approvals go about a second after the last click). */
    const nextSent = async () => {
        for (const until = Date.now() + 5000; sent.length <= read; ) {
            if (Date.now() > until) throw new Error(`no message; sent so far: ${JSON.stringify(sent)}`)
            await page.waitForTimeout(50)
        }
        assert.equal(sent[read].terminal, 'outline-only-sample')
        return sent[read++].text
    }
    const viewerState = async () => (await fetch(`${server.url}/api/state/demo/sample`)).json()

    test('ticking an open node sends its approval, and it shows pending', async () => {
        await box('3.3').click()
        assert.equal(await state('3.3'), 'pending')
        assert.equal(await nextSent(), 'Approved in the outline: 3.3 Who can flush the cache by hand.')
        assert.equal(await state('3.3'), 'pending')
    })

    test('a click on a claim approves it', async () => {
        assert.equal(await box('2.3').getAttribute('title'), 'Claim — click to queue your approval')
        await box('2.3').click()
        assert.equal(await nextSent(), 'Approved in the outline: 2.3 Cache key.')
    })

    test('the file stays as its agent wrote it: the server records no tick in it', async () => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        const before = fs.readFileSync(file, 'utf8')
        // A pick, a tick and an undo.
        await box('2.1.1').click()
        await nextSent()
        await box('3.3').click()
        await nextSent()
        // The page notes what it sent a moment after sending it; an undo before that would have nothing to take back.
        await until(async () => '3.3' in (await viewerState()).sent, { what: 'the sent tick to be noted' })
        await page.keyboard.press('Control+z')
        await nextSent()
        assert.equal(fs.readFileSync(file, 'utf8'), before)
        assert.equal(fs.existsSync(path.join(server.dir, '.ledger')), false)
    })

    test('a burst of ticks goes as one message', async () => {
        // The one under 3.1 last: with 3.3 ticked, its tick leaves nothing open in its topic, which then collapses.
        await box('2.3').click()
        await box('3.3').click()
        await box('3.1.1.1.1.1').click()
        assert.equal(await nextSent(), 'Approved in the outline: 2.3 Cache key; 3.1.1.1.1.1 Drop only that shard\'s entries; 3.3 Who can flush the cache by hand.')
        await page.waitForTimeout(1500)
        assert.equal(sent.length, 1)
    })

    test('picking an option sends the choice and collapses its completed question', async () => {
        await box('2.1.1').click()
        assert.equal(await state('2.1.1'), 'pending')
        assert.equal(await state('2.1.2'), 'open')
        assert.equal(await nextSent(), 'Chosen in the outline: 2.1.1 (A) In each service instance.')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.1"]').getAttribute('aria-expanded') === 'false')
        assert.equal(await state('2.1'), 'pending')
    })

    test('the question’s own box picks the recommended option', async () => {
        await box('2.1').click()
        assert.equal(await nextSent(), 'Chosen in the outline: 2.1.2 (B) A shared Redis cluster.')
    })

    test('the Action tag is the button that runs the action, then waits', async () => {
        const play = node('2.4').locator('.closing [data-run]')
        await click(play)
        assert.equal(await nextSent(), 'Run in the outline: 2.4 Measure the hit rate on staging.')
        await node('2.4').locator('[data-run-sent]').waitFor()
        await play.click()
        await page.waitForTimeout(300)
        assert.equal(sent.length, 1)
        // A node already run has no button.
        assert.equal(await node('2.5').locator('[data-run]').count(), 0)
        // Once the agent marks it @ran, the run request is forgotten.
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        fs.writeFileSync(
            path.join(server.dir, 'demo', 'sample.md'),
            fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8').replace('## 2.4 @action Measure', '## 2.4 @action-done Measure'),
        )
        // The change waits to be opened, and the outline does not move: 2.4 keeps the mark and the tag of an action
        // proposed, and the topic over it stays open.
        await node('2.4').locator('> .env').waitFor()
        assert.equal(await node('2').getAttribute('aria-expanded'), 'true')
        assert.equal(await mark('2.4'), 'action')
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Action'])
        // Opening the change turns its Action tag into Done. With that, nothing under the topic is open any more:
        // once the change has been shown, the topic collapses. Its box rolls up approvals only (the user approved some
        // of what is under it).
        await node('2.4').locator('> .env').click()
        await expanded('2', false)
        assert.equal(await state('2'), 'mixed')
        await expand('2')
        // Its box stays empty: the user has not approved it.
        assert.equal(await mark('2.4'), 'done')
        assert.equal(await state('2.4'), 'open')
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Done'])
        // The Action line says it: no second tag on the title.
        assert.equal(await node('2.4').locator('.node-title .pill-done').count(), 0)
        await until(async () => !(await (await fetch(`${server.url}/api/state/demo/sample`)).json()).runs['2.4'], { what: 'the run request to end' })
    })

    test('undo sends the approval back', async () => {
        await box('3.3').click()
        await nextSent()
        await page.getByRole('button', { name: 'Undo your last approval' }).click()
        assert.equal(await state('3.3'), 'open')
        assert.equal(await nextSent(), 'Reopened in the outline: 3.3 Who can flush the cache by hand.')
        assert.equal(await page.getByRole('button', { name: 'Undo your last approval' }).isDisabled(), true)
    })

    test('undo over mixed children puts each back as it was', async () => {
        await box('3').click()
        assert.equal(
            await nextSent(),
            'Approved in the outline: 3.1 Events that drop entries; 3.1.1 Index updates; 3.1.1.1 Reindexing; 3.1.1.1.1 Partial reindex of one shard; 3.1.1.1.1.1 Drop only that shard\'s entries; 3.2 Time to live; 3.3 Who can flush the cache by hand.',
        )
        // ⌘Z (Ctrl+Z) undoes too. (The page notes what it sent a moment after sending it.)
        await until(async () => '3.3' in (await viewerState()).sent, { what: 'the sent ticks to be noted' })
        await page.keyboard.press('Control+z')
        assert.equal(
            await nextSent(),
            'Reopened in the outline: 3.1 Events that drop entries; 3.1.1 Index updates; 3.1.1.1 Reindexing; 3.1.1.1.1 Partial reindex of one shard; 3.1.1.1.1.1 Drop only that shard\'s entries; 3.3 Who can flush the cache by hand.\nBack to claim in the outline: 3.2 Time to live.',
        )
        // A claim again: its box is empty, and its kind mark was the claim's all along.
        assert.equal(await state('3.2'), 'open')
        assert.equal(await mark('3.2'), 'claim')
        assert.equal(await state('3'), 'open')
    })

    test('undoing a change not sent yet sends nothing', async () => {
        await box('3.3').click()
        await page.keyboard.press('Control+z')
        await page.waitForTimeout(1600)
        assert.deepEqual(sent, [])
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
        assert.equal(await state('2'), 'mixed')
    })

    test('a parent whose nodes are all claims starts collapsed, with an empty box and the claim mark beside it; a click on the box approves them', async () => {
        assert.equal(await node('4').getAttribute('aria-expanded'), 'false')
        assert.equal(await state('4'), 'open')
        assert.deepEqual(await below('4'), ['claim'])
        await box('4').click()
        assert.equal(await nextSent(), 'Approved in the outline: 4.1 Behind a feature flag per tenant; 4.2 Start with internal tenants.')
    })

    test('a parent the viewer opened themselves closes too, a moment after it becomes settled', async () => {
        // Closed and opened again by hand: open is now the viewer's choice, not how the topic starts.
        await node('2').locator('.node-title').click()
        await expanded('2', false)
        await node('2').locator('.node-title').click()
        await expanded('2', true)
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 2.4 @action Measure', '## 2.4 @user-approved Measure'))
        await expanded('2', false)
        // Open with something still open under it, a topic stays as the viewer left it.
        await node('3').locator('.node-title').click()
        await expanded('3', false)
        await node('3').locator('.node-title').click()
        await expanded('3', true)
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 3.2 Time to live', '## 3.2 @user-approved Time to live'))
        await page.waitForTimeout(1200)
        assert.equal(await node('3').getAttribute('aria-expanded'), 'true')
    })

    test('a pending tick clears once the file records it', async () => {
        await expand('4')
        await box('4.1').click()
        await nextSent()
        assert.equal(await state('4.1'), 'pending')
        // 4.1 is a claim: its checkbox is its sparkle, filled, fading in and out until the agent records the approval.
        const drawn = () => node('4.1').locator('> .ck').evaluate(e => (({ animationName, backgroundColor }) => ({ animationName, backgroundColor }))(getComputedStyle(e)))
        const pending = await drawn()
        assert.equal(pending.animationName, 'ckpending')
        assert.deepEqual((await viewerState()).overrides, { 4.1: true })
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor()
        assert.equal(await state('4.1'), 'approved')
        // Recorded: still now, and its bubble is not filled.
        assert.deepEqual(await drawn(), { ...pending, animationName: 'none' })
        assert.equal(pending.backgroundColor, 'rgba(0, 0, 0, 0)')
        await until(async () => Object.keys((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).overrides).length === 0, { what: 'overrides to clear' })
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
        assert.equal(sent.length, 0)
    })

    test('a failed action says so, and can be run again', async () => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        await click(node('2.4').locator('.closing [data-run]'))
        await nextSent()
        await node('2.4').locator('[data-run-sent]').waitFor()
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 2.4 @action Measure', '## 2.4 @action-failed Measure'))
        // The request has ended: the ring is gone, and the change waits to be opened.
        await node('2.4').locator('[data-run-sent]').waitFor({ state: 'detached' })
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('.closing .pill-failed').waitFor()
        await page.locator('.tx-cur').waitFor({ state: 'detached' })
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Failed', 'Run again'])
        // Still in the queue, and it can be run again.
        assert.equal(await page.locator('[data-queue="2.4"]').count(), 1)
        await click(node('2.4').locator('.closing [data-run]'))
        assert.equal(await nextSent(), 'Run in the outline: 2.4 Measure the hit rate on staging.')
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
        await box('2.5').click()
        assert.equal(await state('2.5'), 'pending')
        assert.equal(await nextSent(), 'Approved in the outline: 2.5 Add cache metrics to the dashboard.')
        // Once the agent records the approval, the box is the user's tick, and the kind mark still says done.
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 2.5 @action-done Add', '## 2.5 @user-approved @action-done Add'))
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.5"] > .ck').dataset.state === 'approved')
        assert.equal(await mark('2.5'), 'done')
        assert.equal(await box('2.5').getAttribute('title'), 'Done: the agent carried out this action, and you approved it')
        assert.equal((await below('2')).includes('done'), true)
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
        assert.deepEqual(await queued(), ['2.4', '3.1.1.1.1.1'])
        // Handled here: the icon goes with the item.
        assert.deepEqual([await icon('2.1'), await icon('2.3')], [[], []])
        await click(node('2.4').locator('.closing [data-run]'))
        await nextSent()
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

describe('approvals in file mode without a linked session', () => {
    let server, browser, page
    before(async () => {
        server = await startServer()
        const text = fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8').replace(/^Terminal: .*\n/m, '')
        fs.writeFileSync(path.join(server.dir, 'demo', 'unlinked.md'), text)
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

    test('ticks are copied, and listed until copied', async () => {
        await click(page.locator('.outline-tab [data-num="2.3"] > .ck'))
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).startsWith('Approved'), { what: 'the clipboard' })
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Approved in the outline: 2.3 Cache key.')
        const bar = page.getByRole('region', { name: 'Approvals to copy' })
        assert.match(await bar.textContent(), /✓ 2\.3 Cache key/)
        await click(page.locator('.outline-tab [data-num="3.3"] > .ck'))
        await bar.getByRole('button', { name: 'Copy to clipboard' }).click()
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('3.3'), { what: 'the clipboard' })
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Approved in the outline: 2.3 Cache key; 3.3 Who can flush the cache by hand.')
        await bar.waitFor({ state: 'detached' })
    })

    test('the reference button copies a reference, after any approvals not copied yet', async () => {
        server.resetState()
        await page.reload()
        await page.locator('[data-topbar] [data-title]').waitFor()
        await click(page.locator('.outline-tab [data-num="2.3"] > .ck'))
        const ref = page.locator('.outline-tab [data-num="3.2"]')
        await ref.evaluate(e => e.scrollIntoView({ block: 'center' }))
        await ref.hover()
        await ref.locator('.ask').first().click()
        const expected = 'Approved in the outline: 2.3 Cache key.\nRe: outline "Caching for the search service" › 3. Invalidation › 3.2 Time to live — '
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === expected, { what: 'the reference on the clipboard' })
    })
})
