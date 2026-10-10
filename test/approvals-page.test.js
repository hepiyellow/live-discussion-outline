import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, openPage, startServer, until } from './helpers.js'

// sample.md names a terminal, so the page sends its messages through /send. The tests answer /send themselves and
// record what the page sent: no tmux needed.

/** Clicks an element in the middle of the window: scrolled just into view, it would sit under the sticky headers. */
const click = async locator => {
    await locator.evaluate(e => e.scrollIntoView({ block: 'center' }))
    await locator.click()
}

describe('approvals, picks, runs and undo', () => {
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
        await page.locator('.outline-tab h1').waitFor()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const node = num => page.locator(`.outline-tab [data-num="${num}"]`)
    const box = num => ({ click: () => click(node(num).locator('> .ck')), getAttribute: name => node(num).locator('> .ck').getAttribute(name) })
    const state = num => box(num).getAttribute('data-state')
    /** The next message the page sent (approvals go about a second after the last click). */
    const nextSent = async () => {
        for (const until = Date.now() + 5000; sent.length <= read; ) {
            if (Date.now() > until) throw new Error(`no message; sent so far: ${JSON.stringify(sent)}`)
            await page.waitForTimeout(50)
        }
        assert.equal(sent[read].terminal, 'ldo-sample')
        return sent[read++].text
    }
    const viewerState = async () => (await fetch(`${server.url}/api/state/demo/sample`)).json()

    test('ticking an open node sends its approval, and it shows pending', async () => {
        await box('2.4').click()
        assert.equal(await state('2.4'), 'pending')
        assert.equal(await nextSent(), 'Approved in the outline: 2.4 Measure the hit rate on staging.')
        assert.equal(await state('2.4'), 'pending')
    })

    test('a click on a claim approves it', async () => {
        await box('2.3').click()
        assert.equal(await nextSent(), 'Approved in the outline: 2.3 Cache key.')
    })

    test('a burst of ticks goes as one message', async () => {
        await box('2.4').click()
        await box('3.3').click()
        await box('2.3').click()
        assert.equal(await nextSent(), 'Approved in the outline: 2.3 Cache key; 2.4 Measure the hit rate on staging; 3.3 Who can flush the cache by hand.')
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

    test('play asks the agent to run the action, then waits', async () => {
        const play = node('2.4').locator('.play')
        await click(play)
        assert.equal(await nextSent(), 'Run in the outline: 2.4 Measure the hit rate on staging.')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        await play.click()
        await page.waitForTimeout(300)
        assert.equal(sent.length, 1)
        // A node already run has no play button.
        assert.equal(await node('2.5').locator('.play').count(), 0)
        // Once the agent marks it @ran, the run request is forgotten.
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        fs.writeFileSync(
            path.join(server.dir, 'demo', 'sample.md'),
            fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8').replace('## 2.4 @action Measure', '## 2.4 @action-done Measure'),
        )
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

    test('undo sends the approval back', async () => {
        await box('2.4').click()
        await nextSent()
        await page.getByRole('button', { name: 'Undo your last approval' }).click()
        assert.equal(await state('2.4'), 'open')
        assert.equal(await nextSent(), 'Reopened in the outline: 2.4 Measure the hit rate on staging.')
        assert.equal(await page.getByRole('button', { name: 'Undo your last approval' }).isDisabled(), true)
    })

    test('undo over mixed children puts each back as it was', async () => {
        await box('3').click()
        assert.equal(
            await nextSent(),
            'Approved in the outline: 3.1 Events that drop entries; 3.1.1 Index updates; 3.1.1.1 Reindexing; 3.1.1.1.1 Partial reindex of one shard; 3.1.1.1.1.1 Drop only that shard\'s entries; 3.2 Time to live; 3.3 Who can flush the cache by hand.',
        )
        // ⌘Z (Ctrl+Z) undoes too.
        await page.keyboard.press('Control+z')
        assert.equal(
            await nextSent(),
            'Reopened in the outline: 3.1 Events that drop entries; 3.1.1 Index updates; 3.1.1.1 Reindexing; 3.1.1.1.1 Partial reindex of one shard; 3.1.1.1.1.1 Drop only that shard\'s entries; 3.3 Who can flush the cache by hand.\nBack to claim in the outline: 3.2 Time to live.',
        )
        assert.equal(await state('3.2'), 'claim')
        assert.equal(await state('3'), 'mixed')
    })

    test('undoing a change not sent yet sends nothing', async () => {
        await box('2.4').click()
        await page.keyboard.press('Control+z')
        await page.waitForTimeout(1600)
        assert.deepEqual(sent, [])
    })

    test('completing a parent collapses it, and undo opens it again', async () => {
        await box('4.1').click()
        await box('4.2').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="4"]').getAttribute('aria-expanded') === 'false')
        await page.keyboard.press('Control+z')
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="4"]').getAttribute('aria-expanded') === 'true')
    })

    test('a pending tick clears once the file records it', async () => {
        await box('4.1').click()
        await nextSent()
        assert.equal(await state('4.1'), 'pending')
        assert.deepEqual((await viewerState()).overrides, { 4.1: true })
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor()
        assert.equal(await state('4.1'), 'approved')
        await until(async () => Object.keys((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).overrides).length === 0, { what: 'overrides to clear' })
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
        const file = path.join(server.dir, 'demo', 'sample.md')
        await until(async () => '2.4' in (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read, { what: 'the first visit to be recorded' })
        await click(node('2.4').locator('.play'))
        await nextSent()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 2.4 @action Measure', '## 2.4 @action-failed Measure'))
        // The request has ended: the play button is back, and the change waits to be opened.
        await page.waitForFunction(() => !document.querySelector('.outline-tab [data-num="2.4"] .play').classList.contains('sent'))
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('.closing .pill-failed').waitFor()
        await page.locator('.tx-cur').waitFor({ state: 'detached' })
        assert.deepEqual((await node('2.4').locator('.closing .pill').allTextContents()).map(t => t.trim()), ['Failed'])
        // Still in the queue, and it can be run again.
        assert.equal(await page.locator('[data-queue="2.4"]').count(), 1)
        await click(node('2.4').locator('.play'))
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

    test('a done action shows a filled yellow tick, which a click turns into an approval', async () => {
        assert.equal(await state('2.5'), 'done')
        await box('2.5').click()
        assert.equal(await state('2.5'), 'pending')
        assert.equal(await nextSent(), 'Approved in the outline: 2.5 Add cache metrics to the dashboard.')
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
        assert.deepEqual(await queued(), ['2.4', '3.1.1.1.1.1'])
        // Handled here: the icon goes with the item.
        assert.deepEqual([await icon('2.1'), await icon('2.3')], [[], []])
        await click(node('2.4').locator('.play'))
        await nextSent()
        await page.waitForFunction(() => !document.querySelector('[data-queue="2.4"]'))
        await page.getByRole('button', { name: 'Collapse all' }).click()
        await page.locator('[data-queue="3.1.1.1.1.1"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1.1.1.1"]').hasAttribute('data-qmark'))
        assert.equal(await node('3.1.1.1.1.1').isVisible(), true)
    })
})

describe('approvals without a linked session', () => {
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
        await page.locator('.outline-tab h1').waitFor()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })

    test('ticks are copied, and listed until copied', async () => {
        await click(page.locator('.outline-tab [data-num="2.4"] > .ck'))
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).startsWith('Approved'), { what: 'the clipboard' })
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Approved in the outline: 2.4 Measure the hit rate on staging.')
        const bar = page.getByRole('region', { name: 'Approvals to copy' })
        assert.match(await bar.textContent(), /✓ 2\.4 Measure the hit rate on staging/)
        await click(page.locator('.outline-tab [data-num="3.3"] > .ck'))
        await bar.getByRole('button', { name: 'Copy to clipboard' }).click()
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('3.3'), { what: 'the clipboard' })
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Approved in the outline: 2.4 Measure the hit rate on staging; 3.3 Who can flush the cache by hand.')
        await bar.waitFor({ state: 'detached' })
    })

    test('the reference button copies a reference, after any approvals not copied yet', async () => {
        server.resetState()
        await page.reload()
        await page.locator('.outline-tab h1').waitFor()
        await click(page.locator('.outline-tab [data-num="2.4"] > .ck'))
        const ref = page.locator('.outline-tab [data-num="3.2"]')
        await ref.evaluate(e => e.scrollIntoView({ block: 'center' }))
        await ref.hover()
        await ref.locator('.ask').click()
        const expected = 'Approved in the outline: 2.4 Measure the hit rate on staging.\nRe: outline "Caching for the search service" › 3. Invalidation › 3.2 Time to live — '
        await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === expected, { what: 'the reference on the clipboard' })
    })
})
