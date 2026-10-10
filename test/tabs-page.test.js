import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { launchBrowser, openPage, startServer } from './helpers.js'

describe('the Transcript and Terminal tabs', () => {
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
        server.resetState()
        page = await openPage(browser, `${server.url}/demo/sample`, { viewport: { width: 1200, height: 800 } })
        await page.locator('.outline-tab h1').waitFor()
    })
    afterEach(async () => {
        page.checkErrors()
        await page.close()
    })

    test('the Transcript tab shows the session’s messages and tool calls', async () => {
        await page.getByRole('tab', { name: 'Transcript' }).click()
        const tab = page.locator('.transcript')
        await page.locator('[data-transcript-title]').filter({ hasText: 'Caching search results' }).waitFor()
        assert.deepEqual(await tab.locator('[data-entry="user"]').allTextContents(), ['How should we cache the search results?', 'Thanks. Use Redis.'])
        assert.match(await tab.locator('.transcript-assistant').first().innerHTML(), /<strong>2\.1\.1<\/strong>/)
        // Tool calls are collapsed, their results inside them.
        const bash = tab.locator('[data-tool="toolu_01"]')
        assert.equal(await bash.getAttribute('open'), null)
        assert.match(await bash.locator('summary').textContent(), /Bash Replay queries on staging/)
        await bash.locator('summary').click()
        assert.match(await bash.locator('[data-result="ok"]').textContent(), /hit rate 82%/)
        assert.equal(await tab.locator('[data-tool="toolu_02"] [data-result="error"]').count(), 1)
        // The outline is hidden, the input box is not.
        assert.equal(await page.locator('.outline-tab').isVisible(), false)
        assert.equal(await page.getByRole('textbox', { name: 'Message the session' }).isVisible(), true)
    })

    test('the Terminal tab says when no tmux session is attached', async () => {
        await page.getByRole('tab', { name: 'Terminal' }).click()
        const term = page.locator('[data-terminal]')
        await term.locator('.xterm').waitFor()
        await page.waitForFunction(() => /not attached to tmux session ldo-sample/.test(document.querySelector('[data-terminal] .xterm-rows')?.textContent ?? ''))
        // The terminal takes typing itself: no input box.
        assert.equal(await page.getByRole('textbox', { name: 'Message the session' }).count(), 0)
    })

    test('the tab shown is kept in the viewer state', async () => {
        await page.getByRole('tab', { name: 'Transcript' }).click()
        await page.reload()
        await page.locator('[data-transcript-title]').filter({ hasText: 'Caching search results' }).waitFor()
        assert.equal(await page.getByRole('tab', { name: 'Transcript' }).getAttribute('aria-selected'), 'true')
    })

    test('the outline still updates while another tab shows', async () => {
        await page.getByRole('tab', { name: 'Transcript' }).click()
        server.swap('demo/sample', 'demo/sample-edited')
        await page.getByRole('tab', { name: 'Outline' }).click()
        await page.locator('.outline-tab [data-num="3.4"]').waitFor()
        server.swap('demo/sample', 'demo/sample')
    })
})
