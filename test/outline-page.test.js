import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { outlinePayload } from '../outline.js'
import { FIXTURES, launchBrowser, openPage, startServer } from './helpers.js'

const sample = outlinePayload(fs.readFileSync(path.join(FIXTURES, 'outlines/demo/sample.md'), 'utf8'))
const all = nodes => nodes.flatMap(n => [n, ...all(n.children)])

// Reading and showing an outline is one code path whoever writes it, so each test runs on an outline in file mode and on
// one in server mode.
for (const mode of ['file', 'server']) describe(`the Outline tab, in ${mode} mode`, () => {
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
        server.swap('demo/sample', 'demo/sample', mode)
        server.resetState()
        page = await openPage(browser, `${server.url}/demo/sample`, { viewport: { width: 1200, height: 900 } })
        await page.locator('[data-topbar] [data-title]').waitFor()
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
        assert.equal(await page.locator('[data-topbar] [data-title]').textContent(), 'Caching for the search service')
        assert.match(await page.locator('.outline-intro').textContent(), /answers in 900 ms/)
        for (const n of all(sample.nodes)) {
            assert.equal(await node(n.num).count(), 1, n.num)
            assert.match(await node(n.num).locator('.node-title').textContent(), new RegExp(n.title.slice(0, 12).replace(/[()]/g, '\\$&')), n.num)
        }
    })

    test('the top bar shows the session name, the project and the resume copy button; the box holds the model', async () => {
        const bar = page.locator('[data-topbar]')
        assert.match(await bar.textContent(), /demo/)
        // The Model line sets the model and effort pickers, in the input box.
        assert.equal(await page.getByLabel('Model').inputValue(), 'claude-opus-5-5')
        assert.equal(await page.getByLabel('Effort').inputValue(), 'high')
        assert.match(await bar.locator('[title^="Project: demo"]').getAttribute('title'), /Working folder: \/home\/dev\/search/)
        assert.equal(await bar.getByRole('button', { name: 'Copy the link that reopens this chat' }).count(), 1)
    })

    test('approval boxes, rolled up over children, and kind marks', async () => {
        // A box is ticked by the user's approval alone: a claim, a recommended option and an action done have an empty one.
        const states = {
            1: 'approved',
            // The user approved some of what is under it.
            2: 'mixed',
            '2.1': 'open',
            '2.1.1': 'open',
            '2.1.2': 'open',
            '2.2': 'approved',
            '2.2.1': 'approved',
            '2.2.2': 'open',
            '2.3': 'open',
            '2.4': 'open',
            '2.5': 'open',
            3: 'open',
            '3.2': 'open',
            4: 'open',
            '4.1': 'open',
        }
        for (const [num, state] of Object.entries(states)) assert.equal(await box(num).getAttribute('data-state'), state, num)
        // The approval box stands in front of the triangle and the number; no kind mark is left of it.
        for (const num of ['2', '2.1', '2.3', '2.4']) assert.equal(await node(num).evaluate(el => { const next = el.querySelector(':scope > .ck').nextElementSibling; return next.classList.contains('tri') || next.classList.contains('num') }), true, num)
        assert.equal(await node('2.3').locator('> .km').count(), 0)
        // The kind mark says what the node is on the agent's side: a claim (a question with a recommended option is
        // one, answered or not), an action proposed or done. A node with no stance has an empty place.
        const marks = { 1: null, '1.1': null, '2.1': 'claim', '2.1.1': null, '2.1.2': 'claim', '2.2': 'claim', '2.3': 'claim', '2.4': 'action', '2.5': 'done', 3: null, '3.2': 'claim', '3.3': null, '4.1': 'claim' }
        // Every row has its own mark at its right, in its kind's column, and none at its left.
        const ownMark = num => node(num).evaluate(el => el.querySelector(':scope > .marks .km[data-own]')?.dataset.kind ?? null)
        for (const [num, mark] of Object.entries(marks)) assert.equal(await ownMark(num), mark, num)
        assert.equal(await node('2.1').locator(':scope > .km').count(), 0)
        assert.equal(await node('2.1').locator(':scope > .extras .km[data-own]').count(), 1)
        // A parent shows each kind mark found under it once, small: an action proposed, one done, a claim.
        const under = num => node(num).locator('.extras .km:not([data-own])').evaluateAll(els => els.map(e => e.dataset.key))
        assert.deepEqual(await under('2'), ['claim', 'claim-approved', 'action', 'done'])
        // A topic whose nodes are all claims is settled: it starts collapsed, with the one mark beside it.
        assert.equal(await node('4').getAttribute('aria-expanded'), 'false')
        assert.deepEqual(await under('4'), ['claim'])
        assert.equal(await node('2').getAttribute('aria-expanded'), 'true')
        // Options are radio buttons.
        assert.equal(await box('2.1.2').getAttribute('role'), 'radio')
        assert.equal(await box('2.3').getAttribute('role'), 'checkbox')
    })

    test('only a row in the queue calls for the user: its empty box is drawn in full; left of a title there is no icon for it', async () => {
        const asked = num => node(num).getAttribute('data-asked')
        const border = num => box(num).evaluate(e => getComputedStyle(e).borderTopColor)
        // In the queue: 2.3 to approve, 2.4 to run, and the question 2.1, whose options are where it is answered.
        assert.deepEqual([await asked('2.3'), await asked('2.4'), await asked('2.1'), await asked('2.1.1')], ['true', 'true', 'true', 'true'])
        // Not in it: a claim, a node with no stance, an action done, the option of a question that is not asked.
        assert.deepEqual([await asked('3.2'), await asked('3.3'), await asked('2.5'), await asked('2.2.2')], [null, null, null, null])
        assert.notEqual(await border('2.3'), await border('3.2'))
        assert.equal(await border('3.2'), await border('3.3'))
        assert.equal(await border('2.3'), await border('2.1.1'))
        // Nothing left of a title says a row is asked: the diff button stands there alone.
        assert.equal(await page.locator('.outline-tab :is(.row, .topic-head) > :is(.play, .qicon)').count(), 0)
        // An action has the indicator among its kind marks at the right, in or out of the queue.
        const indicator = () => node('2.4').locator('> .marks [data-point]')
        assert.equal(await indicator().getAttribute('data-kind'), 'action')
        // Out of the queue the action asks nothing. It keeps its indicator, and the button that runs it.
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^- 2\.4 @action .*\n/m, ''))
        await page.locator('[aria-label="Your queue"] [data-queue="2.4"]').waitFor({ state: 'detached' })
        assert.equal(await asked('2.4'), null)
        assert.equal(await indicator().count(), 1)
        assert.equal(await node('2.4').locator('.closing [data-run]').count(), 1)
    })

    test('an action done that the agent queued asks for the user like any item to approve', async () => {
        const file = path.join(server.dir, 'demo', 'sample.md')
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# @queue\n', '# @queue\n- 2.5 @approve Check the metrics on the dashboard.\n'))
        const item = page.locator('[aria-label="Your queue"] [data-queue="2.5"]')
        await item.waitFor()
        assert.equal(await item.getAttribute('data-kind'), 'approve')
        assert.equal(await node('2.5').getAttribute('data-asked'), 'true')
        assert.equal(await node('2.5').locator('> .marks .km[data-own]').getAttribute('data-kind'), 'done')
    })

    test('tags and closing-line tags', async () => {
        const text = async num => node(num).locator('.node-title').textContent()
        assert.match(await text('2.1'), /◉ Pick one/)
        assert.match(await text('2.2'), /◉ Pick one/)
        assert.match(await text('2.1.2'), /Recommended/)
        assert.equal(await node('2.1.2').locator('.pill-recommended svg').count(), 1)
        assert.doesNotMatch(await text('2.1.1'), /Recommended/)
        // An action the agent ran is Done, in yellow; one still to run is not.
        assert.match(await text('2.5'), /Done/)
        assert.equal(await node('2.5').locator('.node-title .pill-done').count(), 1)
        assert.doesNotMatch(await text('2.4'), /Done/)
        const closing = async num => node(num).locator('.closing .pill').allTextContents()
        assert.deepEqual((await closing('2.3')).map(t => t.trim()), ['Summary', 'Recommendation'])
        assert.deepEqual((await closing('2.4')).map(t => t.trim()), ['Action'])
        assert.deepEqual((await closing('3.2')).map(t => t.trim()), ['Recommendation'])
        // The Done tag has the filled triangle of an action done, not a tick: the tick is the user's approval alone.
        assert.equal(await node('2.5').locator('.pill-done svg path[fill="currentColor"]').count(), 1)
        assert.match(await node('2.3').locator('.node-html').innerHTML(), /<li>Normalize case and whitespace<\/li>/)
    })

    test('the kind bubbles of parents line up in one column per kind in view', async () => {
        await page.getByRole('button', { name: 'Collapse all' }).click()
        // With everything collapsed only the topics are rows of the view; each draws the same cells, in the same order.
        const topics = await page.locator('.outline-tab .topic-head').evaluateAll(heads =>
            heads.map(h => ({
                keys: [...h.querySelectorAll('.extras .km-cell:not(.km-box)')].map(c => c.querySelector('.km')?.dataset.key ?? null),
                lefts: [...h.querySelectorAll('.extras .km-cell:not(.km-box)')].map(c => Math.round(c.getBoundingClientRect().left)),
            })),
        )
        assert.ok(topics.length > 1)
        const columns = topics[0].keys.length
        assert.ok(columns >= 3, 'the sample has a claim, an action and a done action in view')
        for (const t of topics) {
            assert.equal(t.keys.length, columns)
            assert.deepEqual(t.lefts, topics[0].lefts)
        }
        // A kind that no row in view shows has no column: every cell is a kind some topic has.
        for (let i = 0; i < columns; i++) assert.ok(topics.some(t => t.keys[i]), `column ${i} is used`)
        // The columns follow the fixed order: claim, claim approved, question, answered, action, done, failed.
        const order = ['claim', 'claim-approved', 'question', 'answered', 'action', 'done', 'failed']
        const seen = topics.flatMap(t => t.keys.filter(Boolean)).filter((k, i, all) => all.indexOf(k) === i)
        assert.deepEqual([...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b)), seen.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)))
        // The buttons are at the far right of every parent row, and its bubbles end where they begin.
        const right = await page.locator('.outline-tab .topic-head .asks').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().right)))
        assert.equal(new Set(right).size, 1)
        // A parent nested under a topic is laid out the same: its cells and its buttons are where the topic's are.
        await page.getByRole('button', { name: 'Expand all' }).click()
        const cellLefts = el => [...el.querySelectorAll('.extras .km-cell:not(.km-box)')].map(c => Math.round(c.getBoundingClientRect().left))
        const asksRight = el => Math.round(el.querySelector('.asks').getBoundingClientRect().right)
        const topic = await node('2').evaluate(cellLefts)
        const nested = await node('2.1').evaluate(cellLefts)
        assert.deepEqual(nested, topic)
        // A node without children too: its own mark is in the same column. Its approval box is where its sibling's is.
        assert.deepEqual(await node('2.3').evaluate(cellLefts), topic)
        const boxLeft = el => Math.round(el.querySelector(':scope > .ck').getBoundingClientRect().left)
        assert.equal(await node('2.3').evaluate(boxLeft), await node('2.1').evaluate(boxLeft))
        assert.equal(await node('2.1').evaluate(asksRight), await node('2').evaluate(asksRight))
    })

    test('a node\'s tags come first, before its text', async () => {
        // Each tagged line is a child of the node's content ahead of every piece of its prose.
        for (const num of ['2.3', '2.4', '3.2']) {
            const kinds = await node(num).locator('.node-html').first().evaluate(el => [...el.children].map(c => (c.classList.contains('closing') ? 'tag' : 'text')))
            const firstText = kinds.indexOf('text')
            assert.ok(kinds.includes('tag'), `${num} has tags`)
            assert.ok(firstText === -1 || kinds.lastIndexOf('tag') < firstText, `${num}: ${kinds.join(',')}`)
        }
    })

    test('approved topics and parents start collapsed; rows collapse and expand', async () => {
        assert.equal(await visible('1.1'), false)
        assert.equal(await visible('2.2.1'), false)
        assert.equal(await visible('3.1.1'), true)
        // On the title: the middle of a row may hold the buttons that show on hover.
        await node('3.1').locator('.node-title').click()
        assert.equal(await visible('3.1.1'), false)
        assert.equal(await node('3.1').getAttribute('aria-expanded'), 'false')
        await node('3.1').locator('.node-title').click()
        assert.equal(await visible('3.1.1'), true)
        await node('1').locator('.node-title').click()
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

    test('the page stays still while headers stick and blocks end under them', async () => {
        await page.setViewportSize({ width: 1200, height: 500 })
        // Without the browser's scroll anchoring, which can hide a page that moves under a scroll position that does not.
        await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' })
        await page.getByRole('button', { name: 'Expand all' }).click()
        const seen = await page.evaluate(async () => {
            const frame = () => new Promise(r => requestAnimationFrame(r))
            const last = document.querySelector('.outline-tab .topic:last-child')
            // Where the last topic is in the page: a stuck header that gave up its room would pull it up.
            const place = () => Math.round((last.getBoundingClientRect().top + scrollY) * 10) / 10
            scrollTo(0, 0)
            await frame()
            await frame()
            const at = place()
            const max = document.documentElement.scrollHeight - innerHeight
            const moved = []
            let stuck = 0
            for (let y = 0; y <= max; y += 3) {
                scrollTo(0, y)
                for (let i = 0; i < 3; i++) {
                    await frame()
                    if (place() !== at) moved.push(y)
                }
                stuck = Math.max(stuck, document.querySelectorAll('.outline-tab [data-stuck]').length)
            }
            return { max, stuck, moved: [...new Set(moved)] }
        })
        // The scroll went past headers that stuck, several deep, and nothing below them ever moved.
        assert.ok(seen.max > 300 && seen.stuck >= 3, JSON.stringify(seen))
        assert.deepEqual(seen.moved, [])
    })

    test('the Markdown tab', async () => {
        await page.getByLabel('View').selectOption({ label: 'Markdown' })
        assert.equal(await page.locator('.outline-tab').isVisible(), false)
        const md = page.locator('.markdown')
        assert.match(await md.locator('h1').first().textContent(), /1\. @user-approved Goals/)
        await page.getByLabel('View').selectOption({ label: 'Outline' })
        assert.equal(await md.isVisible(), false)
    })

    test('an edit of the file re-renders in place, keeping what the viewer collapsed', async () => {
        await page.evaluate(() => (window.notReloaded = true))
        await node('3.1').locator('.node-title').click()
        await node('1').locator('.node-title').click()
        assert.equal(await visible('3.1.1'), false)
        server.swap('demo/sample', 'demo/sample-edited', mode)
        await node('3.4').waitFor()
        assert.equal(await page.evaluate(() => window.notReloaded), true)
        assert.equal(await box('4.1').getAttribute('data-state'), 'approved')
        // A rewritten node keeps what the viewer read until they open the change (unread-page.test.js).
        assert.match(await node('2.3').locator('.node-html').textContent(), /and the index version/)
        assert.equal(await visible('3.1.1'), false)
        assert.equal(await visible('1.1'), true)
    })

    test('a question that lost @options is still a pick of one', async () => {
        const file = path.join(server.dir, 'demo', 'lost.md')
        fs.writeFileSync(file, 'Title: Lost\n\n# 1. Topic\n\n## 1.1 @user-approved Where?\n\nPick one of the options below.\n\n### 1.1.1 @user-approved @option_A Here\n\n### 1.1.2 @option_B There\n')
        const other = await openPage(browser, `${server.url}/demo/lost`)
        try {
            assert.match(await other.locator('.outline-tab [data-num="1.1"] .node-title').textContent(), /Pick one/)
            assert.equal(await other.locator('.outline-tab [data-num="1.1.2"] > .ck').getAttribute('role'), 'radio')
            assert.match(await other.locator('.outline-tab [data-num="1.1.1"] .node-title').textContent(), /\(A\) Here/)
        } finally {
            await other.close()
            fs.rmSync(file, { force: true })
        }
    })

    test('nodes that share a number are pointed out', async () => {
        // The page knows a node by its number: an approval of one would reach the others, under the wrong title.
        assert.equal(await page.locator('[data-duplicates]').count(), 0)
        const file = path.join(server.dir, 'demo', 'twice.md')
        fs.writeFileSync(file, 'Title: Twice\n\n# 1. First\n\n## 1.1 @agent-claim One\n\n# 2. Second\n\n## 2.1 @agent-claim Two\n\n# 2. Second again\n\n## 2.1 Three\n')
        const other = await openPage(browser, `${server.url}/demo/twice`)
        try {
            assert.match(await other.locator('[data-duplicates]').textContent(), /More than one node is numbered 2, 2\.1\./)
        } finally {
            await other.close()
            fs.rmSync(file, { force: true })
        }
    })

    test('a missing outline says so', async () => {
        const other = await openPage(browser, `${server.url}/demo/nope`)
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
        const one = await openPage(browser, `${server.url}/demo/sample`)
        const two = await openPage(browser, `${server.url}/demo/sample`)
        await one.locator('.outline-tab [data-num="3.1"]').click()
        assert.equal(await hidden(one, '3.1.1'), true)
        await two.waitForFunction(() => document.querySelector('.outline-tab [data-num="3.1.1"]').offsetParent === null)
        await one.reload()
        await one.locator('[data-topbar] [data-title]').waitFor()
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
