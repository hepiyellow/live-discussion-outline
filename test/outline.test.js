import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { outlinePayload } from '../outline.js'
import { FIXTURES, SESSION } from './helpers.js'

const sample = outlinePayload(fs.readFileSync(path.join(FIXTURES, 'outlines/demo/sample.md'), 'utf8'))

/** Every node of the outline, depth first. */
const all = nodes => nodes.flatMap(n => [n, ...all(n.children)])
const node = num => all(sample.nodes).find(n => n.num === num)

test('header lines', () => {
    assert.equal(sample.title, 'Caching for the search service')
    assert.equal(sample.resume, `claude --resume ${SESSION}`)
    assert.equal(sample.model, 'Claude Opus 5.5, high')
    assert.equal(sample.terminal, 'ldo-sample')
    assert.equal(sample.session, SESSION)
    assert.match(sample.intro, /^<p>The search service answers in 900 ms/)
})

test('header lines that are not valid are dropped', () => {
    const p = outlinePayload('Title: x\nTerminal: bad name!\nSession: not-an-id\n\n# 1. A')
    assert.equal(p.terminal, '')
    assert.equal(p.session, '')
    assert.equal(p.nodes.length, 1)
})

test('numbering and nesting, six levels deep', () => {
    assert.deepEqual(
        sample.nodes.map(n => n.num),
        ['1', '2', '3', '4'],
    )
    assert.deepEqual(
        node('2').children.map(n => n.num),
        ['2.1', '2.2', '2.3', '2.4', '2.5'],
    )
    const deepest = node('3.1.1.1.1.1')
    assert.equal(deepest.level, 6)
    assert.equal(deepest.title, "Drop only that shard's entries")
    assert.deepEqual(
        all(sample.nodes).map(n => n.level),
        all(sample.nodes).map(n => n.num.split('.').length),
    )
})

test('statuses', () => {
    assert.equal(node('1').status, 'approved')
    assert.equal(node('2').status, 'open')
    assert.equal(node('2.3').status, 'claim')
    // A recommended option, and an untagged node whose text holds a recommendation, read as the agent's claims.
    assert.equal(node('2.1.2').status, 'claim')
    assert.equal(node('3.2').status, 'claim')
    assert.equal(node('2.2.1').status, 'approved')
    assert.equal(node('3.3').status, 'open')
})

test('tags', () => {
    assert.deepEqual(node('2.1').tags, ['options'])
    assert.deepEqual(node('2.1.2').tags, ['recommended'])
    assert.deepEqual(node('2.2').tags, ['approved', 'options'])
    assert.deepEqual(node('2.4').tags, ['action'])
    assert.deepEqual(node('2.5').tags, ['action', 'ran'])
    assert.deepEqual(node('3.1.1.1.1.1').tags, ['current'])
    assert.equal(node('2.1.2').title, '(B) A shared Redis cluster')
})

test('titles render inline markdown', () => {
    const p = outlinePayload('# 1. Use `npm ci` *now*')
    assert.equal(p.nodes[0].title, 'Use npm ci now')
    assert.equal(p.nodes[0].titleHtml, 'Use <code>npm ci</code> <em>now</em>')
})

test('closing lines leave the text and come in order', () => {
    const key = node('2.3')
    assert.deepEqual(
        key.closing.map(c => c.kind),
        ['summary', 'recommendation'],
    )
    assert.equal(key.closing[0].html, 'The key combines the normalized query, the locale and the index version.')
    assert.doesNotMatch(key.html, /@Summary|@Recommendation/)
    assert.match(key.html, /<li>Normalize case and whitespace<\/li>/)
    assert.deepEqual(node('2.4').closing, [{ kind: 'action', html: 'Runs the replay script against staging and reports the hit rate.' }])
    // Out of order in the file, still shown summary first.
    const p = outlinePayload('# 1. A\n\nText.\n\n@Recommendation. Do it.\n\n@Summary. All of it.')
    assert.deepEqual(
        p.nodes[0].closing.map(c => c.kind),
        ['summary', 'recommendation'],
    )
    assert.equal(p.nodes[0].html, '<p>Text.</p>\n')
})

test('node text is HTML with raw HTML escaped', () => {
    assert.match(node('3.1.1.1.1.1').html, /<pre><code>key = hash\(query, locale, version, shard\)\n<\/code><\/pre>/)
    const p = outlinePayload('# 1. A\n\n<script>alert(1)</script>')
    assert.doesNotMatch(p.nodes[0].html, /<script>/)
})

test('the queue', () => {
    assert.deepEqual(sample.queue, [
        { num: '2.1', kind: 'decide', label: 'Pick where the cache lives.' },
        { num: '2.4', kind: 'action', label: 'Measure the hit rate on staging.' },
        { num: '2.3', kind: 'approve', label: 'The cache key you recommended.' },
        { num: '3.1.1.1.1.1', kind: 'read', label: 'Why shard-level invalidation needs the shard id.' },
    ])
    // The queue is not a topic.
    assert.ok(!sample.nodes.some(n => /queue/.test(n.title)))
})

test('the Markdown tab', () => {
    assert.match(sample.markdown, /<h1>1. @approved Goals<\/h1>/)
    assert.doesNotMatch(sample.markdown, /Title: |@queue/)
})
