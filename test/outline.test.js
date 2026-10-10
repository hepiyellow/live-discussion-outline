import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { countCheckboxProgress, outlinePayload } from '../outline.js'
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

test('the list counts statuses the way the page rolls them up', () => {
    // A parent only shows its descendants' statuses; a question counts once.
    const count = lines => countCheckboxProgress(lines.join('\n\n'))
    const question = ['# 1. Topic', '## 1.1 @user-approved @options Where?', '### 1.1.1 @recommended (A) Here', '### 1.1.2 @user-approved (B) There', '#### 1.1.2.1 @user-approved Detail', '### 1.1.3 (C) Nowhere']
    // Picked: the options left behind (the recommended one among them) are neither claims nor open.
    assert.deepEqual(count(question), { total: 1, done: 1, agent: 0, open: 0 })
    // Not picked yet: the recommended option speaks for the question.
    assert.deepEqual(count(question.map(l => l.replaceAll('@user-approved ', ''))), { total: 1, done: 0, agent: 1, open: 0 })
    assert.deepEqual(count(['# 1. Topic', '## 1.1 @options Where?', '### 1.1.1 (A) Here', '### 1.1.2 (B) There']), { total: 1, done: 0, agent: 0, open: 1 })
    // A parent's own tag is not counted, its leaves are; a topic without nodes holds its own status.
    assert.deepEqual(count(['# 1. Topic', '## 1.1 @user-approved Parent', '### 1.1.1 @user-approved A', '### 1.1.2 @agent-claim B', '### 1.1.3 C', '# 2. @user-approved Alone']), { total: 4, done: 2, agent: 1, open: 1 })
})

test('the approval of the user is written @user-approved; older outlines say @approved', () => {
    const status = tag => outlinePayload(`Title: T\n\n# 1. Topic\n\n## 1.1 ${tag} Node\n`).nodes[0].children[0]
    for (const tag of ['@user-approved', '@approved', '@User-Approved']) {
        const node = status(tag)
        assert.equal(node.status, 'approved', tag)
        assert.deepEqual(node.tags, ['approved'], tag)
        // The tag is not part of the title.
        assert.equal(node.title, 'Node', tag)
    }
    assert.equal(status('@user-approved @options').status, 'approved')
})

test('a question whose options carry letters is a question without @options too', () => {
    const lines = tag => ['Title: T', '', '# 1. Topic', '', `## 1.1 ${tag} Where?`, '', '### 1.1.1 @user-approved @option_A Here', '', '### 1.1.2 @option_B There', '', '### 1.1.3 @option_C Nowhere', ''].join('\n')
    // Picked: the other options are neither open nor claimed, with the tag or without it.
    for (const tag of ['@user-approved @options', '@user-approved'])
        assert.deepEqual(countCheckboxProgress(lines(tag)), { total: 1, done: 1, agent: 0, open: 0 }, tag)
})

test('tags that say who or what, and the older names for them', () => {
    const tags = heading => outlinePayload(`Title: T\n\n# 1. Topic\n\n## 1.1 ${heading}\n`).nodes[0].children[0]
    for (const tag of ['@agent-claim', '@claim']) {
        assert.equal(tags(`${tag} Node`).status, 'claim', tag)
        assert.equal(tags(`${tag} Node`).title, 'Node', tag)
    }
    // A done action: one tag now, two before. A failed one can be run again.
    assert.deepEqual(tags('@action-done Run it').tags, ['action', 'ran'])
    assert.deepEqual(tags('@action @ran Run it').tags, ['action', 'ran'])
    assert.deepEqual(tags('@action-failed Run it').tags, ['action', 'failed'])
    assert.equal(tags('@action-failed Run it').title, 'Run it')
    assert.deepEqual(tags('@agent-claim @action Run it').tags, ['claim', 'action'])
    // An option names its letter in a tag; the title reads as it did when the letter was typed into it.
    const option = tags('@recommended @option_B Second option')
    assert.deepEqual([option.option, option.title, option.titleHtml, option.tags], ['B', '(B) Second option', '(B) Second option', ['recommended', 'option']])
    assert.equal(tags('@option-c @user-approved Third').title, '(C) Third')
    assert.equal(tags('(A) First').option, undefined)
    // The Markdown tab shows the letter as the page does.
    const md = outlinePayload('Title: T\n\n# 1. Q\n\n## 1.1 @options Which?\n\n### 1.1.1 @recommended @option_B Second\n').markdown
    assert.match(md, /<h3>1\.1\.1 @recommended \(B\) Second<\/h3>/)
    assert.doesNotMatch(md, /@option_/)
    // `@options` (the question) is not `@option_…` (one of its options).
    assert.deepEqual(tags('@options Which one?').tags, ['options'])
})

test('tags', () => {
    assert.deepEqual(node('2.1').tags, ['options'])
    assert.deepEqual(node('2.1.2').tags, ['recommended', 'option'])
    assert.equal(node('2.1.2').option, 'B')
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
    assert.match(sample.markdown, /<h1>1. @user-approved Goals<\/h1>/)
    assert.doesNotMatch(sample.markdown, /Title: |@queue/)
})
