import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { launchBrowser, openPage, startServer, until } from './helpers.js'

// A session started from New shows in the outlines pane at once, kept on its tmux session until its outline appears.
// It needs tmux: the test runs its own tmux server (TMUX_TMPDIR), never the user's, with a stand-in for claude.

const hasTmux = (() => {
    try {
        execFileSync('tmux', ['-V'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()

describe('a session started from New', { skip: !hasTmux && 'no tmux' }, () => {
    let server, browser, page, scratch, tmuxEnv
    const tmux = (...args) => execFileSync('tmux', args, { env: { ...process.env, ...tmuxEnv }, stdio: 'ignore' })
    before(async () => {
        // A short path: a tmux socket's path is limited to about 100 characters.
        scratch = fs.mkdtempSync('/tmp/ldo-start-')
        const fake = path.join(scratch, 'claude')
        fs.writeFileSync(fake, '#!/bin/sh\nexec sleep 600\n', { mode: 0o755 })
        fs.mkdirSync(path.join(scratch, 'proj'))
        tmuxEnv = { TMUX: '', TMUX_TMPDIR: scratch }
        server = await startServer({ env: { ...tmuxEnv, OUTLINE_CLAUDE: fake } })
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
        try {
            tmux('kill-server')
        } catch {}
        fs.rmSync(scratch, { recursive: true, force: true })
    })
    afterEach(async () => {
        page?.checkErrors()
        await page?.close()
        page = null
    })

    const pane = () => page.locator('nav[aria-label="Outlines"]')
    /** Starts a session in the folder `proj` the way the dialog does, and returns its tmux session. */
    const start = topic =>
        page.evaluate(
            async ({ path, topic }) => (await (await fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'folder', path, topic }) })).json()).terminal,
            { path: path.join(scratch, 'proj'), topic },
        )

    test('shows at once, under its project, and turns into its outline when the outline names its terminal', async () => {
        page = await openPage(browser, `${server.url}/demo/sample`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        const terminal = await start('Brand new topic')
        assert.ok(terminal, 'the server started a tmux session')
        const row = pane().locator(`[data-pane-starting="${terminal}"]`)
        await row.waitFor()
        assert.equal(await row.textContent(), 'Brand new topic')
        assert.equal(await row.getAttribute('href'), `/live?t=${encodeURIComponent(terminal)}`)
        assert.equal(await pane().locator('section').first().getAttribute('data-project'), 'proj')
        // The agent writes the outline, naming its terminal: the outline takes the row's place.
        fs.mkdirSync(path.join(server.dir, 'proj'), { recursive: true })
        fs.writeFileSync(path.join(server.dir, 'proj', 'brand-new-topic.md'), `Title: Brand new topic\nTerminal: ${terminal}\n\n# 1. A\n`)
        await pane().locator('[data-pane-outline="proj/brand-new-topic"]').waitFor()
        await row.waitFor({ state: 'detached' })
    })

    test('leaves the pane when its session ends without an outline', async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        await pane().locator('[data-pane-outline="demo/sample"]').waitFor()
        const terminal = await start('Ends early')
        await pane().locator(`[data-pane-starting="${terminal}"]`).waitFor()
        tmux('kill-session', '-t', `=${terminal}`)
        await until(async () => (await pane().locator(`[data-pane-starting="${terminal}"]`).count()) === 0, { timeout: 8000, what: 'the row to go' })
    })

    test('shows the terminal in the main area, then opens the outline once its first version has a node', async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        const terminal = await start('Watch me')
        await page.goto(`${server.url}/live?t=${encodeURIComponent(terminal)}`)
        await page.getByRole('status').filter({ hasText: 'Waiting for the agent to write the outline' }).waitFor()
        await page.locator('[data-terminal]').waitFor()
        // Headers alone are not the first version: the terminal stays.
        fs.mkdirSync(path.join(server.dir, 'proj'), { recursive: true })
        const file = path.join(server.dir, 'proj', 'watch-me.md')
        fs.writeFileSync(file, `Title: Watch me\nTerminal: ${terminal}\n`)
        await new Promise(r => setTimeout(r, 2500))
        assert.match(page.url(), /\/live\?/)
        fs.writeFileSync(file, `Title: Watch me\nTerminal: ${terminal}\n\n# 1. First\nThe first version.\n`)
        await page.locator('.outline-tab h1').waitFor({ timeout: 8000 })
        assert.match(page.url(), /\/proj\/watch-me$/)
        assert.equal(await page.getByLabel('View').inputValue(), 'outline')
        assert.equal(await page.locator('.outline-tab').isVisible(), true)
        assert.equal(await page.locator('[data-terminal]').isVisible(), false)
    })

    test("its own page marks its row, and the server's list carries it", async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        const terminal = await start('Marked here')
        const list = await (await fetch(`${server.url}/api/outlines`)).json()
        assert.deepEqual(
            list.starting.filter(s => s.terminal === terminal).map(({ project, title }) => ({ project, title })),
            [{ project: 'proj', title: 'Marked here' }],
        )
        await page.goto(`${server.url}/live?t=${encodeURIComponent(terminal)}`)
        await pane().locator(`[aria-current="page"][data-pane-starting="${terminal}"]`).waitFor()
    })
})
