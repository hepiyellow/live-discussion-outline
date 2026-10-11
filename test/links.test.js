import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LINK_BASE, SCHEME, pagePathOf } from '../app/links.js'

// The links that open the Outline app, and the page each shows.

test('the link base is what the skill appends /<project>/<file> to', () => {
    assert.equal(LINK_BASE, `${SCHEME}://open`)
    assert.equal(pagePathOf(`${LINK_BASE}/demo/sample`), '/demo/sample')
})

test('capitals and dashes in the project are kept', () => {
    assert.equal(pagePathOf('outline-only://open/ma3-pro-plugins-mainV2/2026-10-09-heading-format-and-electron'), '/ma3-pro-plugins-mainV2/2026-10-09-heading-format-and-electron')
    assert.equal(pagePathOf('outline-only://open/My%20Project/a%20plan'), '/My%20Project/a%20plan')
    assert.equal(pagePathOf('outline-only://open/My Project/a plan'), '/My%20Project/a%20plan')
})

test('the query and the fragment are dropped', () => {
    assert.equal(pagePathOf('outline-only://open/demo/sample?x=1#2.1'), '/demo/sample')
})

test('anything outside open/<project>/<file> is refused', () => {
    for (const link of [
        'outline-only://open',
        'outline-only://open/',
        'outline-only://open/demo',
        'outline-only://open/demo/',
        'outline-only://open/demo/sample/more',
        'outline-only://open//sample',
        'outline-only://demo/sample',
        'outline-only://close/demo/sample',
        'outline-only:open/demo/sample',
        'outline://open/demo/sample',
        'http://open/demo/sample',
        'https://example.com/demo/sample',
        'not a link',
        '',
    ])
        assert.equal(pagePathOf(link), undefined, link)
})

test('a link cannot name a file outside the outlines folder', () => {
    for (const link of [
        'outline-only://open/../secrets',
        'outline-only://open/demo/..',
        'outline-only://open/%2E%2E/secrets',
        'outline-only://open/demo/..%2F..%2Fetc',
        'outline-only://open/demo/a%5Cb',
        'outline-only://open/.state/sample',
        'outline-only://open/demo/.hidden',
        'outline-only://open/demo/%E0%A4%A',
    ])
        assert.equal(pagePathOf(link), undefined, link)
})
