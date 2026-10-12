import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, startServer, until } from './helpers.js'

// The queue column in the Outline tab's left margin: where it sits, what does not fit, and what arrives. It holds the
// action queue, always in full, and below it the indicators of changes the viewer has not opened, in the room that is
// left. It is the same column whoever writes the outline, so each test runs on an outline in file mode and on one in
// server mode.

for (const mode of ['file', 'server']) describe(`the queue column, in ${mode} mode`, () => {
    let server, browser, page
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    beforeEach(() => {
        server.swap('demo/sample', 'demo/sample', mode)
        server.resetState()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const open = async viewport => {
        page = await browser.newPage({ viewport })
        await page.route('**/send', route => route.fulfill({ status: 200, body: 'sent' }))
        const errors = []
        page.on('pageerror', e => errors.push(e))
        page.checkErrors = () => {
            if (errors.length) throw errors[0]
        }
        await page.goto(`${server.url}/demo/sample`)
        await page.locator('[data-topbar] [data-title]').waitFor()
        await page.locator('[aria-label="Your queue"]').waitFor()
    }
    const rect = selector => page.locator(selector).first().evaluate(e => e.getBoundingClientRect().toJSON())
    /** Rewrites the text of nodes that are not in the action queue, once the first visit has counted every node as read. */
    const rewrite = async nums => {
        await until(async () => Object.keys((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read).length >= 20, { what: 'the first visit to be recorded' })
        const file = path.join(server.dir, 'demo', 'sample.md')
        let text = fs.readFileSync(file, 'utf8')
        for (const num of nums) text = text.replace(new RegExp(`^(#+ ${num.replaceAll('.', '\\.')} .*\\n)`, 'm'), `$1\nRewritten ${num}.\n`)
        fs.writeFileSync(file, text)
    }
    /** Adds items to the end of the outline's queue, the way the agent rewrites the file. */
    const enqueue = lines => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(# @queue\n(?:- .*\n)*)/, `$1${lines.map(l => `${l}\n`).join('')}`))
    }

    test('sits left of the outline, clear of its icons, and stays put while the outline scrolls', async () => {
        await open({ width: 1200, height: 900 })
        const col = await rect('.queue-col')
        const topic = await rect('.outline-tab .topic-head')
        const rail = await rect('nav[aria-label="Outlines"]')
        assert.ok(col.left >= rail.right, `the column (${col.left}) starts right of the rail (${rail.right})`)
        // The topics' queue icons hang 18px left of their heads.
        assert.ok(col.right <= topic.left - 18, `the column (${col.right}) ends left of the topics' icons (${topic.left - 18})`)
        await page.mouse.wheel(0, 600)
        await until(async () => (await page.evaluate(() => scrollY)) > 0, { what: 'the page to scroll' })
        assert.equal((await rect('.queue-col')).top, col.top)
        // The pane on the left holds no queue.
        assert.equal(await page.locator('nav[aria-label="Outlines"] [aria-label="Your queue"]').count(), 0)
    })

    test('on a narrow window the outline gives way, not the queue', async () => {
        await open({ width: 760, height: 900 })
        const col = await rect('.queue-col')
        const topic = await rect('.outline-tab .topic-head')
        const rail = await rect('nav[aria-label="Outlines"]')
        assert.ok(col.left >= rail.right + 12, `the column (${col.left}) keeps its gap from the rail (${rail.right})`)
        assert.ok(col.right <= topic.left - 18, `the column (${col.right}) ends left of the topics' icons (${topic.left - 18})`)
        assert.equal(Math.round(col.width), 64)
    })

    test('shows only in the Outline tab', async () => {
        await open({ width: 1200, height: 900 })
        await page.getByLabel('View').selectOption({ label: 'Markdown' })
        await page.locator('[aria-label="Your queue"]').waitFor({ state: 'hidden' })
    })

    test('the action queue is always shown in full; the change indicators that do not fit are counted on an ellipsis, which lists them', async () => {
        await open({ width: 1200, height: 300 })
        const changed = ['3.2', '3.3', '4.1', '4.2']
        await rewrite(changed)
        const more = page.locator('[data-queue-more]')
        await more.waitFor()
        // Every action item is there, in the agent's order, however little room there is.
        assert.deepEqual(await page.locator('[aria-label="Your queue"] [data-queue]').evaluateAll(els => els.map(e => e.dataset.queue)), ['2.1', '2.4', '2.3', '3.1.1.1.1.1'])
        const shown = await page.locator('[aria-label="Changes to open"] > li > [data-unread]').evaluateAll(els => els.map(e => e.dataset.unread))
        const hidden = Number(await more.getAttribute('data-queue-more'))
        assert.ok(hidden > 0, 'something is hidden')
        assert.equal(shown.length + hidden, changed.length)
        assert.equal((await more.textContent()).trim(), String(hidden))
        // The hidden ones are the last in the outline.
        await more.click()
        const listed = await page.locator('[aria-label="More changes to open"] [data-unread]').evaluateAll(els => els.map(e => e.dataset.unread))
        assert.deepEqual([...shown, ...listed], changed)
        await page.locator(`[aria-label="More changes to open"] [data-unread="${listed.at(-1)}"]`).click()
        await page.waitForFunction(num => document.querySelector(`.outline-tab [data-num="${num}"]`)?.hasAttribute('data-qmark'), listed.at(-1))
        await page.locator('[aria-label="More changes to open"]').waitFor({ state: 'detached' })
    })

    test('a new item slides in from the right; nothing slides in on load', async () => {
        await open({ width: 1200, height: 900 })
        const sliding = () => page.locator('.queue-col li').evaluateAll(els => els.filter(e => e.getAnimations().length).map(e => e.dataset.key))
        assert.deepEqual(await sliding(), [])
        enqueue(['- 3.3 @decide Who may flush.'])
        await page.locator('[data-queue="3.3"]').waitFor()
        assert.deepEqual(await sliding(), ['decide:3.3'])
    })

    test('a new change indicator that lands among the hidden ones pulses the count', async () => {
        await open({ width: 1200, height: 300 })
        await rewrite(['3.2', '3.3', '4.1'])
        const more = page.locator('[data-queue-more]')
        await more.waitFor()
        const hidden = Number(await more.getAttribute('data-queue-more'))
        await rewrite(['4.2'])
        await page.waitForFunction(n => Number(document.querySelector('[data-queue-more]')?.getAttribute('data-queue-more')) === n, hidden + 1)
        assert.equal(await more.getAttribute('data-pulse'), '')
    })
})
