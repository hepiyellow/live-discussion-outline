import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { launchBrowser, openPage, startServer, until } from './helpers.js'

// The node history: switching to another change takes the tree there a node at a time.

describe('the node history', () => {
    let server, browser, page
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const shown = num => page.locator(`.hist-tree [data-hnum="${num}"]`)
    const nums = () => page.locator('.hist-tree [data-hnum="3"] > .hist-kids > [data-hnum]').evaluateAll(els => els.map(e => e.dataset.hnum))

    test('switching to another change marks, then removes, changes and adds its nodes, one at a time', async () => {
        // Topic 3 loses 3.2, has 3.3 renamed and gains 3.4: its history then holds both.
        const file = path.join(server.dir, 'demo', 'sample.md')
        const text = fs.readFileSync(file, 'utf8')
        const edited = text
            .replace(/## 3\.2 Time to live\n[\s\S]*?(?=## 3\.3 )/, '')
            .replace('## 3.3 Who can flush the cache by hand\n', '## 3.3 Who may flush the cache by hand\n\n## 3.4 Warming the cache after a deploy\n\nReplay the top thousand queries before taking traffic.\n')
        assert.notEqual(edited, text)
        fs.writeFileSync(file, edited)
        await until(async () => (await (await fetch(`${server.url}/api/outline/demo/sample/history?num=3`)).json()).length === 2, { what: 'the change to be recorded' })

        // A short window, so the tree is taller than its pane and has to scroll.
        page = await openPage(browser, `${server.url}/demo/sample`, { viewport: { width: 1200, height: 420 } })
        const head = page.locator('.outline-tab [data-num="3"]')
        await head.evaluate(e => e.scrollIntoView({ block: 'center' }))
        await head.hover()
        await head.getByRole('button', { name: 'History of 3', exact: true }).click()
        // The latest change shows at once, as it is.
        await shown('3.4').waitFor()
        assert.deepEqual(await nums(), ['3.1', '3.3', '3.4'])
        assert.equal(await page.locator('.hist-tree :is(.hist-del, .hist-chg, .hist-add)').count(), 0)

        // The pane's scroll, sampled on every frame: its speed in px per second, over a tenth of a second (a frame's
        // scroll is a whole number of px, which alone is 60 px a second).
        await page.evaluate(() => {
            const pane = document.querySelector('.hist-tree').parentElement
            const seen = (window.scrolled = { fastest: 0, moved: 0 })
            const samples = []
            const frame = now => {
                samples.push([now, pane.scrollTop])
                while (samples.length > 1 && now - samples[1][0] >= 100) samples.shift()
                const [at, top] = samples[0]
                if (now - at >= 100) seen.fastest = Math.max(seen.fastest, (Math.abs(pane.scrollTop - top) / (now - at)) * 1000)
                if (samples.length > 1) seen.moved += Math.abs(pane.scrollTop - samples[samples.length - 2][1])
                requestAnimationFrame(frame)
            }
            requestAnimationFrame(frame)
        })

        const started = Date.now()
        await page.getByRole('dialog').locator('ol button').first().click()
        // First the marks: the node about to go in red, the one about to change in orange, and nothing new yet.
        await page.locator('.hist-tree [data-hnum="3.4"].hist-del').waitFor()
        assert.equal(await page.locator('.hist-tree [data-hnum="3.3"].hist-chg').count(), 1)
        assert.equal(await shown('3.2').count(), 0)
        // Then the removed node goes, before the others change.
        await shown('3.4').waitFor({ state: 'detached' })
        assert.ok(Date.now() - started >= 900, 'the marks and the removal take half a second each')
        assert.equal(await shown('3.2').count(), 0)
        // The added node comes last, once the changed one has its text.
        await shown('3.2').waitFor()
        assert.equal(await shown('3.3').locator('> .hist-head > .title-html').innerHTML(), 'Who can flush the cache by hand')
        await page.locator('.hist-tree .hist-add').waitFor({ state: 'detached' })
        assert.ok(Date.now() - started >= 1900, 'four stages of half a second')
        assert.deepEqual(await nums(), ['3.1', '3.2', '3.3'])
        assert.match(await shown('3.2').locator('> .hist-body').textContent(), /Entries expire after 60 seconds/)
        assert.equal(await page.locator('.hist-tree :is(.hist-del, .hist-chg, .hist-add)').count(), 0)
        assert.doesNotMatch(await page.locator('.hist-tree').innerHTML(), /tx-|style="[^"]/)

        // The pane scrolled to the nodes, never faster than 500 px a second.
        const { fastest, moved } = await page.evaluate(() => window.scrolled)
        assert.ok(moved > 0, 'the pane scrolled')
        assert.ok(fastest <= 530, `the pane scrolled at up to ${Math.round(fastest)} px a second`)
    })
})
