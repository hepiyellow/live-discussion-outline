import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, startServer, until } from './helpers.js'

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
        await page.locator('.outline-tab h1').waitFor()
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

    test('a rewritten node keeps what was read, with a diff button; a new node shows at once', async () => {
        await open()
        await firstVisit()
        assert.equal(await page.locator('.outline-tab .env').count(), 0)
        server.swap('demo/sample', 'demo/sample-edited')
        await node('3.4').waitFor()
        assert.match(await text('2.3'), /and the index version/)
        assert.equal(await node('2.3').locator('> .env').count(), 1)
        assert.equal(await node('3.4').locator('> .env').count(), 0)
        assert.match(await text('3.4'), /Replay the top thousand queries/)
        // Approving 4.1 changed its status, not its text: nothing to read.
        assert.equal(await node('4.1').locator('> .env').count(), 0)
        // The left pane lists it first.
        assert.equal(await page.locator('[aria-label="Your queue"] li:first-child [data-unread]').getAttribute('data-unread'), '2.3')
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
        assert.equal(await page.locator('[data-unread]').count(), 0)
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
        assert.equal(await page.locator('[data-unread]').count(), 0)
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

    test('the left pane’s item shows the node and points at its diff button', async () => {
        await open()
        await firstVisit()
        await page.getByRole('button', { name: 'Collapse all' }).click()
        server.swap('demo/sample', 'demo/sample-edited')
        await page.locator('[data-unread="2.3"]').click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.3"] > .env')?.hasAttribute('data-pulse'))
        assert.equal(await node('2.3').isVisible(), true)
        // It only shows the node: the change is still unread.
        assert.match(await text('2.3'), /and the index version/)
    })
})
