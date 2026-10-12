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
        await page.locator('[data-topbar] [data-title]').waitFor()
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

    test('the archive button moves the row to Archived and writes the Archived line; Unarchive brings it back', async () => {
        const file = path.join(server.dir, 'demo', 'shelved.md')
        fs.copyFileSync(path.join(server.dir, 'demo', 'sample.md'), file)
        const group = page.locator('nav[aria-label="Outlines"] section[data-project="demo"]')
        const archived = page.locator('nav[aria-label="Outlines"] section[data-archived]')
        try {
            await group.locator('[data-pane-outline="demo/shelved"]').waitFor()
            assert.equal(await archived.count(), 0)
            const changed = fs.statSync(file).mtimeMs
            await row('shelved').hover()
            await row('shelved').getByRole('button', { name: 'Archive', exact: true }).click()
            // One click, nothing asked: the row leaves its project's group, and Archived, closed, counts it.
            await row('shelved').waitFor({ state: 'detached' })
            assert.match(await archived.getByRole('button', { name: /Archived/ }).textContent(), /Archived\s*1/)
            assert.match(fs.readFileSync(file, 'utf8'), /^Archived: \d{4}-\d\d-\d\d$/m)
            // The outline is where it was, with its time of last change, and the list still has it.
            assert.ok(Math.abs(fs.statSync(file).mtimeMs - changed) < 1, 'the time of last change')
            const listed = (await (await fetch(`${server.url}/api/outlines`)).json()).outlines.find(o => o.file === 'shelved')
            assert.match(listed.archived, /^\d{4}-\d\d-\d\d$/)
            // A search that matches it opens Archived; so does the group's own line.
            await page.getByRole('searchbox', { name: 'Search outlines' }).fill('caching')
            await archived.locator('[data-pane-outline="demo/shelved"]').waitFor()
            await page.getByRole('searchbox', { name: 'Search outlines' }).fill('')
            await row('shelved').waitFor({ state: 'detached' })
            await archived.getByRole('button', { name: /Archived/ }).click()
            assert.match(await row('shelved').textContent(), /demo/)
            await row('shelved').hover()
            await row('shelved').getByRole('button', { name: 'Unarchive' }).click()
            await group.locator('[data-pane-outline="demo/shelved"]').waitFor()
            await archived.waitFor({ state: 'detached' })
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /^Archived:/m)
            assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8'))
        } finally {
            fs.rmSync(file, { force: true })
        }
    })

    test('an archived outline still opens: its page says so, marks its row under Archived, and can unarchive it', async () => {
        const file = path.join(server.dir, 'demo', 'shelved.md')
        fs.writeFileSync(file, fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8').replace(/^(Title: .*\n)/, '$1Archived: 2026-10-12\n'))
        try {
            await page.goto(`${server.url}/demo/shelved`)
            const mark = page.locator('[data-topbar] [data-archived]')
            await mark.waitFor()
            assert.match(await mark.getAttribute('title'), /Archived on 2026-10-12/)
            assert.ok(await page.locator('[data-num]').count())
            await page.locator('nav[aria-label="Outlines"] section[data-archived] [aria-current="page"][data-pane-outline="demo/shelved"]').waitFor()
            await mark.getByRole('button', { name: 'Unarchive' }).click()
            await mark.waitFor({ state: 'detached' })
            await page.locator('nav[aria-label="Outlines"] section[data-project="demo"] [aria-current="page"][data-pane-outline="demo/shelved"]').waitFor()
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /^Archived:/m)
        } finally {
            fs.rmSync(file, { force: true })
        }
    })

    test('the new-session dialog lists folders and past sessions', async () => {
        await page.locator('nav[aria-label="Outlines"]').getByRole('button', { name: 'New', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'New session' })
        await dialog.waitFor()
        // No workspace files in the test's home: the dialog starts on Folder, in the home folder.
        await page.waitForFunction(() => document.querySelector('[aria-label="Folder"]')?.value.length > 0)
        assert.equal(await dialog.getByRole('tab', { name: 'Folder' }).getAttribute('aria-selected'), 'true')
        assert.match(await dialog.getByRole('textbox', { name: 'Folder' }).inputValue(), /outline-only-test-/)
        await dialog.getByRole('button', { name: 'outlines' }).click()
        await page.waitForFunction(() => document.querySelector('[aria-label="Folder"]').value.endsWith('/outlines'))
        await dialog.getByRole('tab', { name: 'Resume a session' }).click()
        // The fixture transcript's session, by its title.
        await dialog.getByText('Caching search results').waitFor()
        assert.match(await dialog.textContent(), /\/home\/dev\/search/)
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'detached' })
    })

    test('the new-session dialog offers the two modes, server mode first; a session with an outline keeps its mode', async () => {
        // What the dialog asks the server to start; the test answers in its place, so nothing starts.
        const asked = []
        await page.route('**/api/start', async route => {
            asked.push(route.request().postDataJSON())
            await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Not started: this is a test.' }) })
        })
        const start = async () => {
            await dialog.getByRole('button', { name: 'Start' }).click()
            await dialog.getByRole('alert').filter({ hasText: 'Not started' }).waitFor()
            return asked.at(-1)
        }
        await page.locator('nav[aria-label="Outlines"]').getByRole('button', { name: 'New', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'New session' })
        await page.waitForFunction(() => document.querySelector('[aria-label="Folder"]')?.value.length > 0)
        const modes = dialog.getByRole('radiogroup', { name: 'Mode' })
        const mode = name => modes.getByRole('radio', { name })
        assert.deepEqual([await mode('Server mode').isChecked(), await mode('File mode').isChecked()], [true, false])
        assert.match(await modes.textContent(), /The server keeps the outline/)
        assert.equal((await start()).mode, 'server')
        await mode('File mode').check()
        assert.match(await modes.textContent(), /The agent writes the outline as a file/)
        const request = await start()
        assert.deepEqual([request.kind, request.mode], ['folder', 'file'])
        // The fixture transcript's session has an outline, sample.md, which its agent writes as a file: resumed, it
        // stays in file mode, and the dialog says so in place of the choice.
        await mode('Server mode').check()
        await dialog.getByRole('tab', { name: 'Resume a session' }).click()
        await dialog.getByText('Caching search results').waitFor()
        await modes.getByText('This session already has an outline in file mode, and keeps it.').waitFor()
        assert.deepEqual([await mode('File mode').isChecked(), await mode('File mode').isDisabled(), await mode('Server mode').isDisabled()], [true, true, true])
        const resume = await start()
        assert.deepEqual([resume.kind, resume.mode], ['resume', 'file'])
        // Back on a folder, the choice made there stands.
        await dialog.getByRole('tab', { name: 'Folder' }).click()
        assert.deepEqual([await mode('Server mode').isChecked(), await mode('Server mode').isDisabled()], [true, false])
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'detached' })
    })
})
