import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { FIXTURES, launchBrowser, startServer, until } from './helpers.js'

describe('unread changes', () => {
    let server, browser, page
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    const open = async (options = {}) => {
        page = await browser.newPage({ viewport: { width: 1200, height: 900 }, ...options })
        const errors = []
        page.on('pageerror', e => errors.push(e))
        page.checkErrors = () => {
            if (errors.length) throw errors[0]
        }
        await page.goto(`${server.url}/demo/sample`)
        await page.locator('[data-topbar] [data-title]').waitFor()
    }
    beforeEach(async () => {
        server.swap('demo/sample', 'demo/sample')
        server.resetState()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const node = num => page.locator(`.outline-tab [data-num="${num}"]`)
    const text = num => node(num).locator('.node-html').textContent()
    const readState = async () => (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read
    /** On a first visit every node below the topics (20 in sample.md) counts as read; this waits until the page has recorded it. */
    const firstVisit = () => until(async () => Object.keys((await (await fetch(`${server.url}/api/state/demo/sample`)).json()).read).length >= 20, { what: 'the first visit to be recorded' })

    test('a rewritten node keeps what was read, with a diff button; a new node is a bare row with a plus until it is opened', async () => {
        await open()
        await firstVisit()
        assert.equal(await page.locator('.outline-tab .env').count(), 0)
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor()
        assert.match(await text('2.3'), /and the index version/)
        assert.equal(await node('2.3').locator('> .env').getAttribute('data-change'), 'changed')
        // The added node is there, with its title and nothing of its text, and the column has its indicator.
        const plus = node('3.4').locator('> .env')
        assert.equal(await plus.getAttribute('data-change'), 'added')
        assert.match(await node('3.4').locator('.title-html').textContent(), /Warming the cache after a deploy/)
        assert.equal((await text('3.4')).trim(), '')
        assert.equal(await page.locator('[aria-label="Changes to open"] [data-unread="3.4"]').getAttribute('data-change'), 'added')
        // Approving 4.1 is the user's own doing, recorded by the agent: nothing to open.
        assert.equal(await node('4.1').locator('> .env').count(), 0)
        // The plus opens it: its text is there, and nothing is left to open on it.
        await plus.click()
        await page.waitForFunction(() => /Replay the top thousand queries/.test(document.querySelector('.outline-tab [data-num="3.4"] .node-html')?.textContent ?? ''))
        assert.equal(await node('3.4').locator('> .env').count(), 0)
        assert.equal(await page.locator('[data-unread="3.4"]').count(), 0)
        // 2.3 is in the action queue, so the column shows it once, there: it has no change indicator of its own, and
        // its item says the node changed.
        assert.equal(await page.locator('[data-unread="2.3"]').count(), 0)
        assert.match(await page.locator('[aria-label="Your queue"] [data-queue="2.3"]').getAttribute('title'), /it changed since you read it/)
    })

    test('a changed node that is not in the action queue has a change indicator, below the queue and a divider', async () => {
        await open()
        await firstVisit()
        assert.equal(await page.locator('[data-queue-divider]').count(), 0)
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(## 3\.2 Time to live\n\n)/, '$1Entries now live for ten minutes. '))
        const indicator = page.locator('[aria-label="Changes to open"] [data-unread="3.2"]')
        await indicator.waitFor()
        const top = selector => page.locator(selector).evaluate(e => e.getBoundingClientRect().top)
        assert.ok((await top('[aria-label="Your queue"] li:last-child')) < (await top('[data-queue-divider]')))
        assert.ok((await top('[data-queue-divider]')) < (await top('[data-unread="3.2"]')))
        // It shows the node and points at its diff button, and opens nothing.
        await indicator.click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.2"] > .env')?.hasAttribute('data-pulse'))
        assert.doesNotMatch(await text('3.2'), /ten minutes/)
    })

    /** Rewrites the outline's file the way an agent does. */
    const rewrite = change => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        const before = fs.readFileSync(file, 'utf8')
        const after = change(before)
        assert.notEqual(after, before)
        fs.writeFileSync(file, after)
    }

    test('a change of kind alone waits too: the row keeps the marks it had, and the indicator shows the new one', async () => {
        await open()
        await firstVisit()
        const own = () => node('3.3').locator('> .marks .km[data-own]')
        assert.equal(await own().count(), 0)
        rewrite(text => text.replace('## 3.3 Who can flush', '## 3.3 @agent-claim Who can flush'))
        const indicator = page.locator('[aria-label="Changes to open"] [data-unread="3.3"]')
        await indicator.waitFor()
        // Opening it brings a claim, so that is what the indicator is drawn with; the row itself has no mark yet.
        assert.equal(await indicator.getAttribute('data-mark'), 'claim')
        assert.equal(await own().count(), 0)
        await node('3.3').locator('> .env').click()
        await own().waitFor()
        assert.equal(await own().getAttribute('data-kind'), 'claim')
        assert.equal(await page.locator('[data-unread="3.3"]').count(), 0)
    })

    test('a topic waits like any node: its title and text stay as read until its diff button is clicked', async () => {
        await open({ reducedMotion: 'reduce' })
        await firstVisit()
        const title = () => node('3').locator('.title-html').textContent()
        rewrite(text => text.replace('# 3. Invalidation\n', '# 3. Invalidation rules\n\nWhat drops an entry, and when.\n'))
        const button = node('3').locator('> .env')
        await button.waitFor()
        assert.equal(await title(), 'Invalidation')
        await button.click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3"] .title-html').textContent === 'Invalidation rules')
        assert.match(await page.locator('.outline-tab .topic:has(> [data-num="3"]) .topic-text').textContent(), /What drops an entry, and when\./)
        assert.equal(await node('3').locator('> .env').count(), 0)
    })

    test('a closed parent shows the diff button for what waits under it, and a click opens all of it; an open one leaves it to its nodes', async () => {
        await open({ reducedMotion: 'reduce' })
        await firstVisit()
        rewrite(text => text.replace('## 3.2 Time to live\n', '## 3.2 Time to live\n\nNow ten minutes.\n').replace('## 3.3 Who can flush the cache by hand\n', '## 3.3 Who can flush the cache by hand\n\nOperators only.\n'))
        await node('3.2').locator('> .env').waitFor()
        // Open, topic 3 has no button of its own: 3.2 and 3.3 show theirs.
        assert.equal(await node('3').locator('> .env').count(), 0)
        await node('3').click()
        const button = node('3').locator('> .env')
        await button.waitFor()
        assert.equal(await button.getAttribute('data-change'), 'under')
        assert.match(await button.getAttribute('title'), /^2 changes under this node/)
        await button.click()
        await until(async () => /ten minutes/.test((await readState())['3.2']) && /Operators only/.test((await readState())['3.3']), { what: 'both changes to be taken in' })
        assert.equal(await node('3').locator('> .env').count(), 0)
        assert.equal(await page.locator('[data-unread]').count(), 0)
    })

    test('a new topic comes with everything under it: one row and one indicator until its plus is clicked', async () => {
        await open()
        await firstVisit()
        rewrite(text => text.replace('# @queue\n', '# 5. Monitoring\n\nWhat to watch.\n\n## 5.1 @options Which dashboard\n\n### 5.1.1 @option_A Grafana\n\n### 5.1.2 @option_B Datadog\n\n# @queue\n- 5.1 @decide Pick a dashboard.\n'))
        const plus = node('5').locator('> .env')
        await plus.waitFor()
        assert.equal(await plus.getAttribute('data-change'), 'added')
        assert.equal(await node('5.1').count(), 0)
        assert.deepEqual(await page.locator('[data-unread]').evaluateAll(els => els.map(e => e.dataset.unread)), ['5'])
        // The action item of a node inside it shows the added topic, which is what there is to click first.
        await page.locator('[aria-label="Your queue"] [data-queue="5.1"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="5"]')?.hasAttribute('data-qmark'))
        assert.equal(await node('5.1').count(), 0)
        await plus.click()
        await node('5.1.2').waitFor()
        assert.equal(await page.locator('.outline-tab .env').count(), 0)
        assert.equal(await page.locator('[data-unread]').count(), 0)
    })

    test('a task whose change is not opened shows no button to run it: what there is to run has not been read', async () => {
        await open({ reducedMotion: 'reduce' })
        await firstVisit()
        assert.equal(await node('2.4').locator('[data-run]').count(), 1)
        rewrite(text => text.replace(/(## 2\.4 @action Measure the hit rate on staging\n)/, '$1\nOn production instead.\n'))
        await node('2.4').locator('> .env').waitFor()
        assert.equal(await node('2.4').locator('[data-run]').count(), 0)
        await node('2.4').locator('> .env').click()
        await node('2.4').locator('[data-run]').waitFor()
        assert.match(await text('2.4'), /On production instead\./)
    })

    test('nodes renumbered after a removed one are not changes to read', async () => {
        await open()
        await firstVisit()
        // 2.3 goes; 2.4 and 2.5 take the numbers before theirs.
        const file = path.join(server.dir, 'demo', 'sample.md')
        const text = fs.readFileSync(file, 'utf8')
        const titles = { 2.4: await node('2.4').locator('.title-html').textContent(), 2.5: await node('2.5').locator('.title-html').textContent() }
        const edited = text.replace(/## 2\.3 [\s\S]*?(?=## 2\.4 )/, '').replace('## 2.4 ', '## 2.3 ').replace('## 2.5 ', '## 2.4 ')
        assert.notEqual(edited, text)
        fs.writeFileSync(file, edited)
        await node('2.5').waitFor({ state: 'detached' })
        assert.equal(await node('2.3').locator('.title-html').textContent(), titles[2.4])
        assert.equal(await node('2.4').locator('.title-html').textContent(), titles[2.5])
        assert.equal(await page.locator('.outline-tab .env').count(), 0)
        assert.equal(await page.locator('[data-unread]').count(), 0)
        await until(async () => !('2.5' in (await readState())), { what: 'the last number to be forgotten' })
    })

    test('the diff button shows the new text (reduced motion: at once)', async () => {
        await open({ reducedMotion: 'reduce' })
        await firstVisit()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('2.3').locator('> .env').waitFor()
        await node('2.3').locator('> .env').evaluate(e => e.scrollIntoView({ block: 'center' }))
        await node('2.3').locator('> .env').click()
        await page.waitForFunction(() => /and the tenant/.test(document.querySelector('.outline-tab [data-num="2.3"] .node-html').textContent))
        assert.match(await text('2.3'), /Results differ by tenant as well as by locale/)
        assert.match(await node('2.3').locator('.closing').first().textContent(), /the locale and the tenant/)
        assert.equal(await node('2.3').locator('> .env').count(), 0)
        // What is left to open is the node that was added.
        assert.deepEqual(await page.locator('[data-unread]').evaluateAll(els => els.map(e => e.dataset.unread)), ['3.4'])
        assert.match((await readState())['2.3'], /and the tenant/)
    })

    test('the animation ends with exactly the new text', async () => {
        await open()
        await firstVisit()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('2.3').locator('> .env').waitFor()
        await node('2.3').locator('> .env').evaluate(e => e.scrollIntoView({ block: 'center' }))
        await node('2.3').locator('> .env').click()
        // The cursor passes through the text, then leaves.
        await page.locator('.tx-cur').waitFor({ state: 'attached' })
        await page.locator('.tx-cur').waitFor({ state: 'detached', timeout: 10000 })
        const html = await node('2.3').locator('.node-html').innerHTML()
        assert.doesNotMatch(html, /tx-/)
        assert.match(html, /Results differ by tenant as well as by locale/)
        assert.equal(await node('2.3').locator('> .env').count(), 0)
    })

    test('each stage of the animation takes half a second, however long the text', async () => {
        // A node of two hundred words, then the same with every fifth word rewritten and a sentence added.
        const file = path.join(server.dir, 'demo', 'sample.md')
        const long = Array.from({ length: 200 }, (_, i) => `word${i}`)
        const withText = words => fs.readFileSync(path.join(FIXTURES, 'outlines/demo/sample.md'), 'utf8').replace('## 3.3 Who can flush the cache by hand\n', `## 3.3 Who can flush the cache by hand\n\n${words.join(' ')}\n`)
        fs.writeFileSync(file, withText(long))
        await open()
        await firstVisit()
        await page.waitForFunction(() => /word199/.test(document.querySelector('.outline-tab [data-num="3.3"] .node-html').textContent))
        fs.writeFileSync(file, withText([...long.map((w, i) => (i % 5 ? w : `changed${i}`)), 'and', 'a', 'new', 'closing', 'sentence.']))
        const button = node('3.3').locator('> .env')
        await button.waitFor()
        await button.evaluate(e => e.scrollIntoView({ block: 'center' }))
        // From the cursor showing up to its leaving.
        await page.evaluate(() => {
            const seen = (window.tx = {})
            new MutationObserver(() => {
                const cursor = document.querySelector('.tx-cur')
                if (cursor) seen.from ??= performance.now()
                else if (seen.from) seen.to ??= performance.now()
            }).observe(document.body, { childList: true })
        })
        await button.click()
        // First the rewritten words are marked, in orange, and nothing has come in yet.
        await page.locator('.tx-o.c .tx-u').first().waitFor()
        assert.equal(await node('3.3').locator('.tx-n .tx-u.on').count(), 0)
        assert.match(await node('3.3').locator('.node-html').evaluate(e => e.innerText), /^word0 word1 /)
        const took = await (await page.waitForFunction(() => window.tx.to && window.tx.to - window.tx.from, null, { timeout: 10000 })).jsonValue()
        // Three stages here (the marks, the rewritten words, the added ones), then the last colour fading and the
        // cursor leaving: 1880 ms, with some room for a busy machine.
        assert.ok(took > 1700 && took < 2300, `the animation took ${Math.round(took)} ms`)
        assert.match(await text('3.3'), /changed195 word196.*a new closing sentence\./)
        assert.doesNotMatch(await node('3.3').locator('.node-html').innerHTML(), /tx-/)
    })

    test('a parent’s hover button opens every change under it, and the parent stays where it is', async () => {
        await open()
        await firstVisit()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('2.3').locator('> .env').waitFor()
        // Scrolled so that topic 2 is well below the top of the window, and not stuck.
        await node('1').evaluate(e => e.scrollIntoView({ block: 'start' }))
        const head = node('2')
        await head.scrollIntoViewIfNeeded()
        await page.evaluate(() => scrollBy(0, -250))
        const topBefore = await head.evaluate(e => e.getBoundingClientRect().top)
        await head.hover()
        const button = head.locator('.ask-diff')
        assert.equal(await button.getAttribute('data-unread-under'), '1')
        await button.click()
        await node('2.3').locator('> .env').waitFor({ state: 'detached' })
        await page.waitForFunction(() => !document.querySelector('.tx-cur'))
        assert.match(await text('2.3'), /Results differ by tenant as well as by locale/)
        assert.equal(await node('2.3').locator('> .env').count(), 0)
        assert.equal(await head.locator('.ask-diff').count(), 0)
        const topAfter = await head.evaluate(e => e.getBoundingClientRect().top)
        assert.ok(Math.abs(topAfter - topBefore) < 1, `the parent moved from ${topBefore} to ${topAfter}`)
        assert.match((await readState())['2.3'], /and the tenant/)
    })

    test('a collapsed parent’s hover button takes in its changes at once', async () => {
        await open()
        await firstVisit()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('2.3').locator('> .env').waitFor()
        await node('2').click()
        await node('2.3').waitFor({ state: 'hidden' })
        await node('2').hover()
        await node('2').locator('.ask-diff').click()
        await until(async () => /and the tenant/.test((await readState())['2.3']), { what: 'the change to be taken in' })
        // Nothing was opened that the viewer had collapsed.
        assert.equal(await node('2.3').isVisible(), false)
    })

    test('what was read survives a reload', async () => {
        await open()
        await firstVisit()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('2.3').locator('> .env').waitFor()
        await page.reload()
        await node('2.3').locator('> .env').waitFor()
        assert.match(await text('2.3'), /and the index version/)
    })

    test('the action item of a changed node shows the node and points at its diff button: the change is opened first', async () => {
        await open()
        await firstVisit()
        await page.getByRole('button', { name: 'Collapse all' }).click()
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor({ state: 'attached' })
        await page.locator('[aria-label="Your queue"] [data-queue="2.3"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.3"] > .env')?.hasAttribute('data-pulse'))
        assert.equal(await node('2.3').isVisible(), true)
        // It only shows the node: the change is still unread.
        assert.match(await text('2.3'), /and the index version/)
    })
})
