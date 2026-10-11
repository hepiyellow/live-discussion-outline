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
    /** The command a started session runs: the stand-in for claude, with the arguments the server gave it. */
    const commandOf = terminal => execFileSync('tmux', ['display-message', '-p', '-t', `=${terminal}:`, '#{pane_start_command}'], { env: { ...process.env, ...tmuxEnv }, encoding: 'utf8' }).trim()
    /** POST /api/start as the dialog sends it: the answer's status and JSON. */
    const post = request =>
        page.evaluate(async request => {
            const res = await fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
            return { status: res.status, ...(await res.json()) }
        }, request)
    before(async () => {
        // A short path: a tmux socket's path is limited to about 100 characters.
        scratch = fs.mkdtempSync('/tmp/outline-only-start-')
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
        await page.locator('[data-topbar] [data-title]').waitFor({ timeout: 8000 })
        assert.match(page.url(), /\/proj\/watch-me$/)
        assert.equal(await page.getByLabel('View').inputValue(), 'outline')
        assert.equal(await page.locator('.outline-tab').isVisible(), true)
        assert.equal(await page.locator('[data-terminal]').isVisible(), false)
    })

    test('starts in the mode asked for: each mode has its skill, and only server mode is given the outline tools', async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        const folder = path.join(scratch, 'proj')
        const inServer = commandOf((await post({ kind: 'folder', path: folder, topic: 'Kept by the server', mode: 'server' })).terminal)
        assert.match(inServer, / --plugin-dir \S+\/plugin /)
        assert.match(inServer, / --allowedTools mcp__plugin_outline-only_outline /)
        assert.match(inServer, / -- "\/outline-only:outline Kept by the server"$/)
        const inFile = commandOf((await post({ kind: 'folder', path: folder, topic: 'Kept as a file', mode: 'file' })).terminal)
        assert.match(inFile, / --plugin-dir \S+\/plugin /)
        assert.doesNotMatch(inFile, /allowedTools/)
        assert.match(inFile, / -- "\/outline-only:outline-file Kept as a file"$/)
        // Without a mode it is server mode, the one the dialog preselects.
        assert.match(commandOf((await post({ kind: 'folder', path: folder, topic: 'Not said' })).terminal), / -- "\/outline-only:outline Not said"$/)
    })

    test('any other mode is refused, and starts nothing', async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        const before = (await (await fetch(`${server.url}/api/outlines`)).json()).starting.length
        for (const mode of ['mcp', '', 'Server', 7, null]) {
            const answer = await post({ kind: 'folder', path: path.join(scratch, 'proj'), topic: 'Refused', mode })
            assert.deepEqual({ status: answer.status, error: answer.error }, { status: 400, error: 'unknown mode' }, JSON.stringify(mode))
        }
        assert.equal((await (await fetch(`${server.url}/api/outlines`)).json()).starting.length, before)
    })

    test('a resumed session keeps the mode of the outline that links to it; without one, the mode asked for applies', async () => {
        page = await openPage(browser, `${server.url}/`, { viewport: { width: 1280, height: 800 } })
        const folder = path.join(scratch, 'proj')
        const transcripts = path.join(server.home, '.claude', 'projects', '-tmp-proj')
        fs.mkdirSync(transcripts, { recursive: true })
        const session = (id, title) => {
            fs.writeFileSync(path.join(transcripts, `${id}.jsonl`), `${JSON.stringify({ cwd: folder, sessionId: id, type: 'user', message: { role: 'user', content: title } })}\n`)
            return id
        }
        const byHand = session('aaaaaaaa-1111-4222-8333-444444444444', 'An outline written by hand')
        const kept = session('bbbbbbbb-1111-4222-8333-444444444444', 'An outline the server keeps')
        const none = session('cccccccc-1111-4222-8333-444444444444', 'No outline yet')
        fs.mkdirSync(path.join(server.dir, 'proj'), { recursive: true })
        fs.writeFileSync(path.join(server.dir, 'proj', 'by-hand.md'), `Title: By hand\nSession: ${byHand}\n\n# 1. A\n`)
        fs.writeFileSync(path.join(server.dir, 'proj', 'kept.md'), `Title: Kept\nSession: ${kept}\nMode: server\n\n# 1. A\n`)
        // The dialog is told which sessions have an outline, and in which mode.
        const { sessions } = await (await fetch(`${server.url}/api/start-options`)).json()
        assert.deepEqual(
            [byHand, kept, none].map(id => sessions.find(s => s.id === id).mode),
            ['file', 'server', undefined],
        )
        const resumed = async (id, mode) => commandOf((await post({ kind: 'resume', id, mode })).terminal)
        // Asked for the other mode, each keeps its own.
        const file = await resumed(byHand, 'server')
        assert.match(file, new RegExp(` --resume ${byHand} `))
        assert.match(file, / -- \/outline-only:outline-file$/)
        assert.doesNotMatch(file, /allowedTools/)
        const server_ = await resumed(kept, 'file')
        assert.match(server_, / --allowedTools mcp__plugin_outline-only_outline -- \/outline-only:outline$/)
        assert.match(await resumed(none, 'file'), / -- \/outline-only:outline-file$/)
        fs.rmSync(path.join(server.dir, 'proj'), { recursive: true })
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
