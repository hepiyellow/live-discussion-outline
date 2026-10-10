import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { eventStream, launchBrowser, openPage, startServer } from './helpers.js'

// The outlines pane on the left of every page: outlines grouped by project, kept up to date without a reload.

describe('the outlines pane', () => {
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
        server.swap('demo/sample', 'demo/sample')
        for (const dir of ['other', 'newer']) fs.rmSync(path.join(server.dir, dir), { recursive: true, force: true })
        fs.rmSync(path.join(server.dir, 'demo', 'fresh.md'), { force: true })
    })
    afterEach(async () => {
        page?.checkErrors()
        await page?.close()
        page = null
    })

    const pane = () => page.locator('nav[aria-label="Outlines"]')
    /** The pane's groups, each as its project and its outlines' titles, top to bottom. */
    const groups = () =>
        pane()
            .locator('section')
            .evaluateAll(els => els.map(s => ({ project: s.dataset.project, titles: [...s.querySelectorAll('a')].map(a => a.textContent) })))
    /** Writes an outline, its change time `ago` seconds back. */
    const write = (project, file, title, ago = 0) => {
        const full = path.join(server.dir, project, `${file}.md`)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, `Title: ${title}\n\n# 1. A\n`)
        const t = new Date(Date.now() - ago * 1000)
        fs.utimesSync(full, t, t)
    }

    test("an outline's stream carries the outline list", async () => {
        const stream = await eventStream(`${server.url}/api/outline/demo/sample/events`)
        try {
            let event
            do event = await stream.take()
            while (event.event !== 'outlines')
            assert.ok(JSON.parse(event.data).outlines.some(o => o.project === 'demo' && o.file === 'sample'))
            write('demo', 'fresh', 'Fresh')
            do event = await stream.take()
            while (event.event !== 'outlines')
            assert.ok(JSON.parse(event.data).outlines.some(o => o.file === 'fresh'))
        } finally {
            stream.close()
        }
    })

    test('groups outlines by project, the latest change first, and marks the open one', async () => {
        write('other', 'old', 'An older outline', 3600)
        write('other', 'new', 'A newer outline', 60)
        // The fixtures (sample.md and sample-edited.md): changed half an hour ago.
        const t = new Date(Date.now() - 1800 * 1000)
        for (const f of ['sample', 'sample-edited']) fs.utimesSync(path.join(server.dir, 'demo', `${f}.md`), t, t)
        page = await openPage(browser, `${server.url}/app/demo/sample`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="other/new"]').waitFor()
        assert.deepEqual(await groups(), [
            { project: 'other', titles: ['A newer outline', 'An older outline'] },
            { project: 'demo', titles: ['Caching for the search service', 'Caching for the search service'] },
        ])
        assert.equal(await pane().locator('[aria-current="page"]').getAttribute('data-pane-outline'), 'demo/sample')
        // The page leaves the pane its room.
        const paneBox = await pane().boundingBox()
        const barBox = await page.locator('[data-topbar]').first().boundingBox()
        assert.ok(barBox.x >= paneBox.x + paneBox.width, 'the top bar starts right of the pane')
    })

    test('follows outlines as they are written, without a reload', async () => {
        page = await openPage(browser, `${server.url}/app/demo/sample`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        await page.evaluate(() => (window.notReloaded = true))
        write('newer', 'topic', 'Just written')
        await pane().locator('[data-pane-outline="newer/topic"]').waitFor()
        assert.equal((await groups())[0].project, 'newer')
        assert.equal(await page.evaluate(() => window.notReloaded), true)
    })

    test('a row opens its outline', async () => {
        write('other', 'new', 'A newer outline')
        page = await openPage(browser, `${server.url}/app/demo/sample`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="other/new"]').click()
        await page.waitForURL('**/app/other/new')
        await pane().locator('[aria-current="page"][data-pane-outline="other/new"]').waitFor()
    })

    test('shows on the list of all outlines and on a starting session, with "All outlines" marked on the list', async () => {
        page = await openPage(browser, `${server.url}/app/`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        assert.equal(await pane().locator('[aria-current="page"]').textContent(), 'All outlines')
        await page.close()
        page = await openPage(browser, `${server.url}/app/live?t=no-such-session`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        assert.equal(await pane().locator('[aria-current="page"]').count(), 0)
    })

    test('dragging its edge resizes it, the page follows, and the width is kept', async () => {
        page = await openPage(browser, `${server.url}/app/demo/sample`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        const handle = page.getByRole('separator', { name: 'Resize the outlines pane' })
        const h = await handle.boundingBox()
        await page.mouse.move(h.x + h.width / 2, h.y + 200)
        await page.mouse.down()
        await page.mouse.move(400, h.y + 220, { steps: 5 })
        await page.mouse.up()
        assert.equal(Math.round((await pane().boundingBox()).width), 400)
        assert.equal(Math.round((await page.locator('[data-topbar]').first().boundingBox()).x), 400)
        await page.reload()
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        assert.equal(Math.round((await pane().boundingBox()).width), 400)
        await handle.dblclick()
        assert.equal(Math.round((await pane().boundingBox()).width), 260)
    })
})
