import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { SESSION, launchBrowser, startServer, until } from './helpers.js'

// sample.md links a session (Terminal: and Session: lines) whose transcript is the fixture. The tests answer /send.

describe('inbox, input box and spinner', () => {
    let server, browser, page, sent, stopped
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    const open = async () => {
        await page.goto(`${server.url}/demo/sample`)
        await page.locator('[data-topbar] [data-title]').waitFor()
    }
    beforeEach(async () => {
        server.swap('demo/sample', 'demo/sample')
        server.resetState()
        sent = []
        page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
        await page.route('**/send', async route => {
            sent.push(route.request().postDataJSON().text)
            await route.fulfill({ status: 200, body: 'sent' })
        })
        stopped = []
        await page.route('**/stop', async route => {
            stopped.push(route.request().postDataJSON().terminal)
            await route.fulfill({ status: 200, body: 'stopped' })
        })
        const errors = []
        page.on('pageerror', e => errors.push(e))
        page.checkErrors = () => {
            if (errors.length) throw errors[0]
        }
        await open()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    const node = num => page.locator(`.outline-tab [data-num="${num}"]`)
    const box = () => page.getByRole('textbox', { name: 'Message the session' })
    const waitSent = async n => {
        for (const until = Date.now() + 5000; sent.length < n; ) {
            if (Date.now() > until) throw new Error(`sent: ${JSON.stringify(sent)}`)
            await page.waitForTimeout(50)
        }
        return sent[n - 1]
    }

    test('the @message shows in the inbox with a closed envelope, and is read once it is clicked', async () => {
        const inbox = page.getByRole('button', { name: 'Messages from the agent' })
        await inbox.waitFor()
        assert.equal((await inbox.textContent()).trim(), '1')
        await inbox.click()
        const list = page.locator('[data-slot="popover-content"]')
        assert.match(await list.textContent(), /The staging replay finished with an 82% hit rate\./)
        assert.match(await list.textContent(), /2\.4/)
        // Opening the list reads nothing: the envelope is closed and the count stays.
        const message = list.locator('[data-message]')
        assert.equal(await message.getAttribute('data-read'), null)
        assert.equal((await inbox.textContent()).trim(), '1')
        await message.getByRole('button', { name: /Unread/ }).click()
        await message.locator('[data-read]').or(page.locator('[data-message][data-read]')).first().waitFor()
        assert.equal((await inbox.textContent()).trim(), '')
        await page.keyboard.press('Escape')
        // Seen marks live in the viewer state.
        await page.reload()
        await page.getByRole('button', { name: 'Messages from the agent' }).waitFor()
        assert.equal((await page.getByRole('button', { name: 'Messages from the agent' }).textContent()).trim(), '')
    })

    test('the @message shows on its node and the topic above it; its number shows the node', async () => {
        const own = node('2.4').getByRole('button', { name: 'Messages about 2.4' })
        await own.waitFor()
        assert.equal(await node('2').getByRole('button', { name: 'Messages about 2' }).count(), 1)
        assert.equal(await node('2.3').getByRole('button', { name: /Messages about/ }).count(), 0)
        await own.evaluate(e => e.scrollIntoView({ block: 'center' }))
        await own.click()
        const list = page.locator('[data-slot="popover-content"]')
        assert.match(await list.textContent(), /Messages about 2\.4/)
        await page.keyboard.press('Escape')
        await list.waitFor({ state: 'detached' })
        await page.getByRole('button', { name: 'Collapse all' }).click()
        await page.getByRole('button', { name: 'Messages from the agent' }).click()
        await page.locator('[data-slot="popover-content"]').getByRole('button', { name: '2.4' }).click()
        await page.waitForFunction(() => document.querySelector('.outline-tab [data-num="2.4"]').offsetParent !== null)
    })

    test('a chip and text compose one message to the session', async () => {
        await node('3.2').evaluate(e => e.scrollIntoView({ block: 'center' }))
        await node('3.2').hover()
        await node('3.2').locator('.ask').first().click()
        const chip = page.locator('[data-chip="3.2 Time to live"]')
        await chip.waitFor()
        // The click shows in the chip, which grows and shrinks once; no notice slides in for it.
        assert.equal(await chip.evaluate(e => getComputedStyle(e).animationName), 'chipin')
        assert.equal(await chip.evaluate(e => getComputedStyle(e).animationIterationCount), '1')
        assert.equal(await page.getByText('Added to the message box').count(), 0)
        // Adding it again plays the pulse again, on the one chip.
        await chip.evaluate(e => (e.dataset.old = '1'))
        await node('3.2').hover()
        await node('3.2').locator('.ask').first().click()
        await page.locator('[data-chip="3.2 Time to live"]:not([data-old])').waitFor()
        assert.equal(await page.locator('[data-chip]').count(), 1)
        await box().fill('Why 60 seconds?')
        await box().press('Enter')
        assert.equal(await waitSent(1), 'Re: outline "Caching for the search service" › 3. Invalidation › 3.2 Time to live\nWhy 60 seconds?')
        await page.locator('[data-chip]').waitFor({ state: 'detached' })
        assert.equal(await box().inputValue(), '')
        // Sending starts the working dot on the button: the agent is working.
        await page.locator('[role="status"][data-busy]').waitFor()
    })

    test('the trash button adds a removal to the box, which asks why', async () => {
        await node('3.2').evaluate(e => e.scrollIntoView({ block: 'center' }))
        await node('3.2').hover()
        await node('3.2').getByRole('button', { name: 'Remove 3.2' }).click()
        const chip = page.locator('[data-chip="3.2 Time to live"][data-chip-kind="remove"]')
        await chip.waitFor()
        assert.equal(await chip.locator('svg[aria-label="Remove"]').count(), 1)
        assert.match(await box().getAttribute('placeholder'), /^Why should it be removed\?/)
        // A reference to the same node is another chip, with no trash.
        await node('3.2').hover()
        await node('3.2').locator('.ask').first().click()
        await page.locator('[data-chip="3.2 Time to live"]:not([data-chip-kind])').waitFor()
        await page.getByRole('button', { name: 'Remove 3.2 Time to live' }).last().click()
        assert.equal(await page.locator('[data-chip]').count(), 1)
        await box().fill('We settled this in 3.1.')
        await box().press('Enter')
        assert.equal(await waitSent(1), 'Removed from the outline: 3. Invalidation › 3.2 Time to live\nWe settled this in 3.1.')
        await page.locator('[data-chip]').waitFor({ state: 'detached' })
        assert.match(await box().getAttribute('placeholder'), /^Message the session/)
    })

    test('while the agent works the button stops it, until a new message is typed', async () => {
        // Idle with nothing typed: a send button that cannot be pressed, and no dot.
        assert.equal(await page.getByRole('button', { name: 'Send' }).isDisabled(), true)
        assert.equal(await page.locator('[aria-label="The agent is idle"]').isVisible(), false)
        await box().fill('Go on')
        await box().press('Enter')
        await waitSent(1)
        const dot = page.locator('[role="status"][data-busy]')
        await dot.waitFor()
        await page.getByRole('button', { name: 'Stop' }).waitFor()
        // Typing a new message brings the send button back; the dot keeps blinking.
        await box().fill('And another thing')
        await page.getByRole('button', { name: 'Send' }).waitFor()
        assert.equal(await page.getByRole('button', { name: 'Stop' }).count(), 0)
        assert.equal(await dot.isVisible(), true)
        assert.notEqual(await dot.evaluate(e => getComputedStyle(e).animationName), 'none')
        await box().fill('')
        await page.getByRole('button', { name: 'Stop' }).click()
        await until(() => stopped.length === 1, { what: 'the stop to be sent' })
        assert.deepEqual(stopped, ['outline-only-sample'])
        assert.deepEqual(sent, ['Go on'])
    })

    test('Shift+Enter adds a line; Backspace at the start drops the last chip', async () => {
        await node('2').locator('.ask').first().click({ force: true })
        await page.locator('[data-chip="2. Where the cache lives"]').waitFor()
        await box().click()
        await box().press('Backspace')
        await page.locator('[data-chip]').waitFor({ state: 'detached' })
        await box().type('one')
        await box().press('Shift+Enter')
        await box().type('two')
        assert.equal(await box().inputValue(), 'one\ntwo')
        await page.getByRole('button', { name: 'Send' }).click()
        assert.equal(await waitSent(1), 'one\ntwo')
    })

    test('the draft is kept across a reload', async () => {
        await box().fill('half a thought')
        await until(async () => (await (await fetch(`${server.url}/api/state/demo/sample`)).json()).draft === 'half a thought', { what: 'the draft to be saved' })
        await page.reload()
        await box().waitFor()
        await page.waitForFunction(() => document.querySelector('textarea').value === 'half a thought')
    })

    test('slash commands are listed as you type, and Enter completes one', async () => {
        await box().click()
        await box().type('/mod')
        const menu = page.getByRole('listbox', { name: 'Slash commands' })
        await menu.waitFor()
        assert.match(await menu.textContent(), /\/model/)
        await box().press('Enter')
        assert.equal(await box().inputValue(), '/model ')
        await menu.waitFor({ state: 'detached' })
        assert.deepEqual(sent, [])
    })

    test('the effort picker sends /effort', async () => {
        await page.getByLabel('Effort').selectOption('low')
        assert.equal(await waitSent(1), '/effort low')
        assert.equal(await page.getByLabel('Effort').inputValue(), 'low')
    })

    describe('what the pickers show', () => {
        const transcript = () => path.join(server.home, '.claude', 'projects', '-home-dev-search', `${SESSION}.jsonl`)
        let original, n
        beforeEach(() => {
            original = fs.readFileSync(transcript(), 'utf8')
            n = 0
        })
        // The fixture transcript is every test's: put it back, and wait until the server has read it again.
        afterEach(() => fs.writeFileSync(transcript(), original))
        /** The agent answers, as Claude Code writes it: with the model and effort it used. */
        const answers = (model, effort) => {
            const at = new Date(Date.UTC(2026, 9, 2, 10, 0, n++)).toISOString()
            const entry = { isSidechain: false, sessionId: SESSION, uuid: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, timestamp: at, type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text: 'Done.' }] }, effort }
            fs.appendFileSync(transcript(), `${JSON.stringify(entry)}\n${JSON.stringify({ isSidechain: false, sessionId: SESSION, timestamp: at, type: 'system', subtype: 'turn_duration', durationMs: 1 })}\n`)
        }
        const shown = async () => [await page.getByLabel('Model').inputValue(), await page.getByLabel('Effort').inputValue()]
        const shows = (model, effort) => until(async () => (await shown()).join() === `${model},${effort}`, { what: `the pickers to show ${model}, ${effort}` })

        test('before the agent has answered, what the Model line names', async () => {
            assert.deepEqual(await shown(), ['claude-opus-5-5', 'high'])
        })

        test('what the agent last answered with, whatever the Model line says', async () => {
            answers('claude-sonnet-5-5', 'medium')
            await shows('claude-sonnet-5-5', 'medium')
            // A dated id is the model it starts with; one the list does not know shows by its id.
            answers('claude-haiku-5-5-20261001', 'low')
            await shows('claude-haiku-5-5', 'low')
            answers('claude-next-9', 'ultra')
            await shows('claude-next-9', 'ultra')
        })

        test('a pick holds when the agent rewrites the Model line, until its next answer', async () => {
            answers('claude-sonnet-5-5', 'medium')
            await shows('claude-sonnet-5-5', 'medium')
            await page.getByLabel('Model').selectOption('claude-opus-5-5')
            await page.getByLabel('Effort').selectOption('max')
            assert.equal(await waitSent(2), '/effort max')
            assert.deepEqual(await shown(), ['claude-opus-5-5', 'max'])
            // The agent writes the line as it believes it: the old model, and no effort.
            const file = path.join(server.dir, 'demo', 'sample.md')
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^Model: .*$/m, 'Model: Claude Sonnet 5.5'))
            await page.waitForTimeout(600)
            assert.deepEqual(await shown(), ['claude-opus-5-5', 'max'])
            // Its next answer says what the session uses: here the model was taken, and the effort was not.
            answers('claude-opus-5-5', 'high')
            await shows('claude-opus-5-5', 'high')
        })

        test('a pick made while the agent works waits for the turn to end, then for the next answer', async () => {
            answers('claude-sonnet-5-5', 'medium')
            await shows('claude-sonnet-5-5', 'medium')
            // The agent is in a turn: the last entry is an answer, with no end of turn after it.
            const at = '2026-10-02T11:00:00.000Z'
            const working = model => fs.appendFileSync(transcript(), `${JSON.stringify({ isSidechain: false, sessionId: SESSION, timestamp: at, type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text: 'Working.' }] }, effort: 'medium' })}\n`)
            working('claude-sonnet-5-5')
            await page.getByRole('status', { name: 'The agent is working' }).waitFor()
            await page.getByLabel('Model').selectOption('claude-opus-5-5')
            assert.equal(await waitSent(1), '/model claude-opus-5-5')
            // More of the same turn, on the old model: the pick is not dropped for it.
            fs.appendFileSync(transcript(), `${JSON.stringify({ isSidechain: false, sessionId: SESSION, timestamp: '2026-10-02T11:00:05.000Z', type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Still working.' }] }, effort: 'medium' })}\n`)
            await page.waitForTimeout(600)
            assert.deepEqual(await shown(), ['claude-opus-5-5', 'medium'])
            fs.appendFileSync(transcript(), `${JSON.stringify({ isSidechain: false, sessionId: SESSION, timestamp: '2026-10-02T11:00:06.000Z', type: 'system', subtype: 'turn_duration', durationMs: 1 })}\n`)
            // The idle dot is hidden, so it has no role to find it by.
            await page.waitForFunction(() => !document.querySelector('[role="status"][data-busy]'))
            assert.deepEqual(await shown(), ['claude-opus-5-5', 'medium'])
            // The next turn's answer is the one the pick applies to.
            n = 30
            answers('claude-opus-5-5', 'medium')
            await shows('claude-opus-5-5', 'medium')
        })
    })
})
