import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, startServer, until } from './helpers.js'

// sample.md links a session (Terminal: and Session: lines) whose transcript is the fixture. The tests answer /send.

describe('inbox, input box and spinner', () => {
    let server, browser, page, sent
    before(async () => {
        server = await startServer()
        browser = await launchBrowser()
    })
    after(async () => {
        await browser?.close()
        await server?.stop()
    })
    const open = async () => {
        await page.goto(`${server.url}/app/demo/sample`)
        await page.locator('.outline-tab h1').waitFor()
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

    test('the @message shows in the inbox, and is seen once opened', async () => {
        const inbox = page.getByRole('button', { name: 'Messages from the agent' })
        await inbox.waitFor()
        assert.equal((await inbox.textContent()).trim(), '1')
        await inbox.click()
        const list = page.locator('[data-slot="popover-content"]')
        assert.match(await list.textContent(), /The staging replay finished with an 82% hit rate\./)
        assert.match(await list.textContent(), /2\.4/)
        await page.keyboard.press('Escape')
        assert.equal((await inbox.textContent()).trim(), '')
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
        await node('3.2').locator('.ask').click()
        await page.locator('[data-chip="3.2 Time to live"]').waitFor()
        await box().fill('Why 60 seconds?')
        await box().press('Enter')
        assert.equal(await waitSent(1), 'Re: outline "Caching for the search service" › 3. Invalidation › 3.2 Time to live\nWhy 60 seconds?')
        await page.locator('[data-chip]').waitFor({ state: 'detached' })
        assert.equal(await box().inputValue(), '')
        // Sending starts the spinner: the agent is working.
        await page.locator('[role="status"][data-busy]').waitFor()
    })

    test('Shift+Enter adds a line; Backspace at the start drops the last chip', async () => {
        await node('2').locator('.ask').click({ force: true })
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
})
