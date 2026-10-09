import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { outlinePayload } from '../outline.js'
import { FIXTURES, launchBrowser, openPage, startServer } from './helpers.js'

const sample = outlinePayload(fs.readFileSync(path.join(FIXTURES, 'outlines/demo/sample.md'), 'utf8'))
const all = nodes => nodes.flatMap(n => [n, ...all(n.children)])

describe('the Outline tab', () => {
    let server, browser, page
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
        page = await openPage(browser, `${server.url}/app/demo/sample`, { viewport: { width: 1200, height: 900 } })
        await page.locator('.outline-tab h1').waitFor()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const node = num => page.locator(`.outline-tab [data-num="${num}"]`)
    const box = num => node(num).locator('> .ck')
    const visible = num => node(num).isVisible()

    test('shows the title, the text before the first topic, and every node', async () => {
        assert.equal(await page.title(), 'Caching for the search service')
        assert.equal(await page.locator('.outline-tab h1').textContent(), 'Caching for the search service')
        assert.match(await page.locator('.outline-intro').textContent(), /answers in 900 ms/)
        for (const n of all(sample.nodes)) {
            assert.equal(await node(n.num).count(), 1, n.num)
            assert.match(await node(n.num).locator('.node-title').textContent(), new RegExp(n.title.slice(0, 12).replace(/[()]/g, '\\$&')), n.num)
        }
    })

    test('the top bar shows the project, the model and the resume copy button', async () => {
        const bar = page.locator('[data-topbar]')
        assert.match(await bar.textContent(), /demo/)
        assert.match(await bar.textContent(), /Claude Opus 5\.5, high/)
        assert.match(await bar.locator('[title^="Project: demo"]').getAttribute('title'), /Working folder: \/home\/dev\/search/)
        assert.equal(await bar.getByRole('button', { name: 'Copy the link that reopens this chat' }).count(), 1)
    })

    test('status icons, rolled up over children', async () => {
        const states = {
            1: 'approved',
            2: 'mixed',
            '2.1': 'claim',
            '2.1.1': 'open',
            '2.1.2': 'claim',
            '2.2': 'approved',
            '2.2.1': 'approved',
            // The recommended option of a question already decided reads as open.
            '2.2.2': 'open',
            '2.3': 'claim',
            '2.4': 'open',
            3: 'mixed',
            '3.2': 'claim',
            4: 'claim',
            '4.1': 'claim',
        }
        for (const [num, state] of Object.entries(states)) assert.equal(await box(num).getAttribute('data-state'), state, num)
        // A mixed topic shows each kind below it once.
        assert.deepEqual(await node('2').locator('.extras .ck').evaluateAll(els => els.map(e => e.dataset.state)), ['open', 'claim', 'approved'])
        // Options are radio buttons.
        assert.equal(await box('2.1.2').getAttribute('role'), 'radio')
        assert.equal(await box('2.3').getAttribute('role'), 'checkbox')
    })

    test('tags and closing-line tags', async () => {
        const text = async num => node(num).locator('.node-title').textContent()
        assert.match(await text('2.1'), /◉ Pick one/)
        assert.match(await text('2.2'), /◉ Pick one/)
        assert.match(await text('2.1.2'), /💡 Recommended/)
        assert.doesNotMatch(await text('2.1.1'), /Recommended/)
        assert.match(await text('2.5'), /Ran/)
        assert.doesNotMatch(await text('2.4'), /Ran/)
        const closing = async num => node(num).locator('.closing .pill').allTextContents()
        assert.deepEqual(await closing('2.3'), ['Summary', '💡 Recommendation'])
        assert.deepEqual((await closing('2.4')).map(t => t.trim()), ['Action'])
        assert.deepEqual(await closing('3.2'), ['💡 Recommendation'])
        assert.match(await node('2.3').locator('.node-html').innerHTML(), /<li>Normalize case and whitespace<\/li>/)
    })

    test('approved topics and parents start collapsed; rows collapse and expand', async () => {
        assert.equal(await visible('1.1'), false)
        assert.equal(await visible('2.2.1'), false)
        assert.equal(await visible('3.1.1'), true)
        await node('3.1').click()
        assert.equal(await visible('3.1.1'), false)
        assert.equal(await node('3.1').getAttribute('aria-expanded'), 'false')
        await node('3.1').click()
        assert.equal(await visible('3.1.1'), true)
        await node('1').click()
        assert.equal(await visible('1.1'), true)
    })

    test('expand all and collapse all', async () => {
        await page.getByRole('button', { name: 'Collapse all' }).click()
        for (const num of ['1.1', '2.1', '3.1', '4.1']) assert.equal(await visible(num), false, num)
        await page.getByRole('button', { name: 'Expand all' }).click()
        for (const num of ['1.1', '2.2.1', '3.1.1.1.1.1', '4.1']) assert.equal(await visible(num), true, num)
    })

    test('the current path, and the jump to it', async () => {
        const path = ['3', '3.1', '3.1.1', '3.1.1.1', '3.1.1.1.1', '3.1.1.1.1.1']
        for (const num of path) assert.match(await node(num).getAttribute('class'), /\bcurrent\b/, num)
        assert.doesNotMatch(await node('2').getAttribute('class'), /\bcurrent\b/)
        await page.getByRole('button', { name: 'Collapse all' }).click()
        await page.getByRole('button', { name: 'Jump to the current node' }).click()
        // The scroll takes 200 ms; it ends with the node's parents stuck above it.
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1.1.1"]').hasAttribute('data-stuck'))
        await page.waitForTimeout(300)
        // It sits just below the stack of headers above it.
        const { top, stack } = await page.evaluate(() => {
            const el = document.querySelector('.outline-tab [data-num="3.1.1.1.1.1"]')
            const parent = document.querySelector('.outline-tab [data-num="3.1.1.1.1"]')
            return { top: el.getBoundingClientRect().top, stack: parent.getBoundingClientRect().bottom }
        })
        assert.ok(top >= stack && top < stack + 20, `${top} below ${stack}`)
    })

    test('headers stack while their nodes scroll by', async () => {
        // Short enough for the outline to scroll past its headers.
        await page.setViewportSize({ width: 1200, height: 500 })
        await page.evaluate(() => {
            const el = document.querySelector('.outline-tab [data-num="3.1.1.1.1.1"]')
            scrollTo(0, scrollY + el.getBoundingClientRect().top - 150)
        })
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1"]').hasAttribute('data-stuck'))
        const tops = await page.evaluate(() =>
            ['3', '3.1', '3.1.1'].map(n => Math.round(document.querySelector(`.outline-tab [data-num="${n}"]`).getBoundingClientRect().top)),
        )
        const bar = await page.locator('[data-topbar]').evaluate(e => e.offsetHeight)
        assert.equal(tops[0], bar)
        assert.ok(tops[1] > tops[0] && tops[2] > tops[1], tops.join(' < '))
    })

    test('the Markdown tab', async () => {
        await page.getByRole('tab', { name: 'Markdown' }).click()
        assert.equal(await page.locator('.outline-tab').isVisible(), false)
        const md = page.locator('.markdown')
        assert.match(await md.locator('h1').first().textContent(), /1\. @approved Goals/)
        await page.getByRole('tab', { name: 'Outline' }).click()
        assert.equal(await md.isVisible(), false)
    })

    test('an edit of the file re-renders in place, keeping what the viewer collapsed', async () => {
        await page.evaluate(() => (window.notReloaded = true))
        await node('3.1').click()
        await node('1').click()
        assert.equal(await visible('3.1.1'), false)
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor()
        assert.equal(await page.evaluate(() => window.notReloaded), true)
        assert.equal(await box('4.1').getAttribute('data-state'), 'approved')
        assert.match(await node('2.3').locator('.node-html').textContent(), /and the tenant/)
        assert.equal(await visible('3.1.1'), false)
        assert.equal(await visible('1.1'), true)
    })

    test('a missing outline says so', async () => {
        const other = await openPage(browser, `${server.url}/app/demo/nope`)
        await other.getByText('There is no outline demo/nope').waitFor()
        await other.close()
    })
})

describe('the viewer state', () => {
    let server, browser
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })

    const hidden = (page, num) => page.locator(`.outline-tab [data-num="${num}"]`).isHidden()

    test('a node collapsed stays collapsed after a reload, and a second window follows', async () => {
        const one = await openPage(browser, `${server.url}/app/demo/sample`)
        const two = await openPage(browser, `${server.url}/app/demo/sample`)
        await one.locator('.outline-tab [data-num="3.1"]').click()
        assert.equal(await hidden(one, '3.1.1'), true)
        await two.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1"]').offsetParent === null)
        await one.reload()
        await one.locator('.outline-tab h1').waitFor()
        await one.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1"]').offsetParent === null)
        // And back, from the second window.
        await two.locator('.outline-tab [data-num="3.1"]').click()
        await one.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1"]').offsetParent !== null)
        one.checkErrors()
        two.checkErrors()
        await one.close()
        await two.close()
    })
})
