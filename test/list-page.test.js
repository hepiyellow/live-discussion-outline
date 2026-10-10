import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { eventStream, launchBrowser, openPage, startServer, until } from './helpers.js'

describe('the outline list', () => {
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
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1200, height: 800 } })
        await page.locator('[data-pane-outline="demo/sample"]').waitFor()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })
    /** An outline's row in the pane, and its link. */
    const row = name => page.locator('nav[aria-label="Outlines"] li').filter({ has: page.locator(`[data-pane-outline="demo/${name}"]`) })
    const link = name => page.locator(`[data-pane-outline="demo/${name}"]`)

    test('/api/outlines lists the outlines, and its stream follows them', async () => {
        const list = await (await fetch(`${server.url}/api/outlines`)).json()
        const sample = list.outlines.find(o => o.file === 'sample')
        assert.equal(sample.title, 'Caching for the search service')
        assert.deepEqual(sample.checkbox, { total: 12, done: 3, agent: 5, open: 4 })
        assert.equal(typeof list.terminals, 'boolean')
        const stream = await eventStream(`${server.url}/api/outlines/events`)
        try {
            await stream.take()
            fs.writeFileSync(path.join(server.dir, 'demo', 'fresh.md'), 'Title: Fresh\n\n# 1. A\n')
            assert.ok(JSON.parse((await stream.take()).data).outlines.some(o => o.file === 'fresh'))
        } finally {
            stream.close()
            fs.rmSync(path.join(server.dir, 'demo', 'fresh.md'), { force: true })
        }
    })

    test('the page is the pane and a pointer to it; a row opens its outline', async () => {
        assert.equal(await page.locator('table').count(), 0)
        assert.equal((await page.locator('[data-empty-state]').textContent()).trim(), 'Pick an outline on the left, or start one with New.')
        assert.equal(await link('sample').textContent(), 'Caching for the search service')
        await link('sample').click()
        await page.waitForURL(/\/demo\/sample$/)
        await page.locator('.outline-tab h1').waitFor()
    })

    test('renaming rewrites the Title line, and the list follows', async () => {
        await row('sample').hover()
        await row('sample').getByRole('button', { name: 'Rename' }).click()
        const input = page.getByRole('textbox', { name: 'Outline name' })
        await input.fill('Search caching')
        await input.press('Enter')
        await until(() => /^Title: Search caching$/m.test(fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8')), { what: 'the Title line' })
        await link('sample').filter({ hasText: 'Search caching' }).waitFor()
        // Escape cancels.
        await row('sample').hover()
        await row('sample').getByRole('button', { name: 'Rename' }).click()
        await page.getByRole('textbox', { name: 'Outline name' }).fill('Not this')
        await page.getByRole('textbox', { name: 'Outline name' }).press('Escape')
        assert.match(fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8'), /^Title: Search caching$/m)
    })

    test('the trash button asks once, then moves the outline to .trash/', async () => {
        fs.copyFileSync(path.join(server.dir, 'demo', 'sample.md'), path.join(server.dir, 'demo', 'doomed.md'))
        await row('doomed').waitFor()
        await row('doomed').hover()
        await row('doomed').getByRole('button', { name: 'Move to trash' }).click()
        assert.ok(fs.existsSync(path.join(server.dir, 'demo', 'doomed.md')))
        await row('doomed').getByRole('button', { name: 'Move to trash?' }).click()
        await row('doomed').waitFor({ state: 'detached' })
        assert.ok(!fs.existsSync(path.join(server.dir, 'demo', 'doomed.md')))
        assert.ok(fs.existsSync(path.join(server.dir, '.trash', 'demo', 'doomed.md')))
    })

    test('the page title has the same pencil', async () => {
        await page.goto(`${server.url}/demo/sample`)
        await page.locator('.outline-tab h1').getByRole('button', { name: 'Rename' }).click()
        await page.getByRole('textbox', { name: 'Outline name' }).fill('Caching, renamed')
        await page.getByRole('textbox', { name: 'Outline name' }).press('Enter')
        await page.locator('.outline-tab h1 [data-title]').filter({ hasText: 'Caching, renamed' }).waitFor()
    })

    test('the new-session dialog lists folders and past sessions', async () => {
        await page.locator('nav[aria-label="Outlines"]').getByRole('button', { name: 'New', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'New session' })
        await dialog.waitFor()
        // No workspace files in the test's home: the dialog starts on Folder, in the home folder.
        await page.waitForFunction(() => document.querySelector('[aria-label="Folder"]')?.value.length > 0)
        assert.equal(await dialog.getByRole('tab', { name: 'Folder' }).getAttribute('aria-selected'), 'true')
        assert.match(await dialog.getByRole('textbox', { name: 'Folder' }).inputValue(), /ldo-test-/)
        await dialog.getByRole('button', { name: 'outlines' }).click()
        await page.waitForFunction(() => document.querySelector('[aria-label="Folder"]').value.endsWith('/outlines'))
        await dialog.getByRole('tab', { name: 'Resume a session' }).click()
        // The fixture transcript's session, by its title.
        await dialog.getByText('Caching search results').waitFor()
        assert.match(await dialog.textContent(), /\/home\/dev\/search/)
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'detached' })
    })
})
