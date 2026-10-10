import MarkdownIt from 'markdown-it'
import { isSessionName } from './terminal.js'
import { isSessionId } from './transcript.js'

// The one parser of outlines: header lines, queue and nodes, into the JSON the page shows (`outlinePayload`).

/** The server's markdown renderer: the page never renders markdown itself (ADR 0001). */
const md = new MarkdownIt({ html: false, linkify: true })

/** Longest `Title:` value the page reads; a longer one is dropped. */
export const TITLE_MAX = 300

/** Pulls a `<Label>: <value>` line (if any) out of the first lines of the source; the value is used as written. */
function extractHeader(source, label, maxLength) {
    const lines = source.split('\n')
    const i = lines.slice(0, 8).findIndex(line => line.startsWith(`${label}: `))
    if (i < 0) return { value: '', source }
    const value = lines[i].slice(label.length + 2).trim().replace(/^`+|`+$/g, '')
    lines.splice(i, 1)
    return { value: value.length <= maxLength ? value : '', source: lines.join('\n') }
}

/**
 * The outline's header lines, and the source without them: `Title:` (the outline session's name), `Resume:` (link or
 * command the page copies), `Model:` (shown as written), `Terminal:` (the tmux session the Terminal tab attaches to) and
 * `Session:` (the agent's session id, whose transcript the Transcript tab shows). The queue is taken out too.
 */
export function extractHeaders(text) {
    const title = extractHeader(text, 'Title', TITLE_MAX)
    const resume = extractHeader(title.source, 'Resume', 500)
    const model = extractHeader(resume.source, 'Model', 100)
    const terminal = extractHeader(model.source, 'Terminal', 64)
    const session = extractHeader(terminal.source, 'Session', 36)
    const queue = extractQueue(session.source)
    return {
        title: title.value,
        resume: resume.value,
        model: model.value,
        terminal: isSessionName(terminal.value) ? terminal.value : '',
        session: isSessionId(session.value) ? session.value : '',
        queue: queue.items,
        source: queue.source,
    }
}

const QUEUE_HEADING = /^#{1,2} @queue$/
const QUEUE_ITEM = /^[-*]\s+(\d+(?:\.\d+)*)\.?\s+@(decide|action|approve|read)\b\s*(.*)$/

/**
 * The queue: a `# @queue` section (no number, so a topic never matches) listing, in priority order,
 * `- <number> @decide|@action|@approve|@read <label>`. It runs to the next heading or the end, and is not part of the outline.
 * Older outlines head it `## @queue`.
 */
function extractQueue(source) {
    const lines = source.split('\n')
    const start = lines.findIndex(line => QUEUE_HEADING.test(line.trim()))
    if (start < 0) return { items: [], source }
    let end = lines.findIndex((line, i) => i > start && /^#{1,6} /.test(line))
    if (end < 0) end = lines.length
    const items = lines
        .slice(start + 1, end)
        .map(line => line.trim().match(QUEUE_ITEM))
        .filter(Boolean)
        .map(([, num, kind, label]) => ({ num, kind, label: label.replace(/\*\*/g, '').trim() }))
    lines.splice(start, end - start)
    return { items, source: lines.join('\n') }
}

/**
 * The outline's nodes are its headings: `# 2. @user-approved Title` is a topic, `## 2.1 @agent-claim @options Title` a node under
 * it, down to `######`. A node's text is everything up to the next heading, rendered as ordinary markdown (bullets
 * included). Status and the other tags sit on the heading line, right after the number.
 */
const HEAD_RE = /^(\d+(?:\.\d+)*)\.?(?:\s+|$)([\s\S]*)$/
// A longer name comes before the name it starts with (`action-done` before `action`), or the shorter one would match.
const TAG_RE = /^@(user-approved|approved|agent-claim|claim|option[_-][a-z]|options|recommended|current|action-done|action-failed|action|ran)\b\s*/i
/** `@option_A`: the node is option A of the question above it. The letter is in the tag, where it cannot be mistyped into the title. */
const OPTION_RE = /^option[_-]([a-z])$/i
/**
 * The tags as outlines write them say who or what: `@user-approved`, `@agent-claim`, `@action-done`, `@action-failed`.
 * Outlines written before those names say `@approved`, `@claim` and `@action @ran`. Both read as the same tags here.
 */
const TAG_NAMES = { 'user-approved': ['approved'], 'agent-claim': ['claim'], 'action-done': ['action', 'ran'], 'action-failed': ['action', 'failed'] }
const REC_MARK = /@recommendation\./i
/** Tags that open a node's closing lines, after its prose: `@Summary.`, `@Recommendation.`, `@Action.` (in any order). */
const TRAIL_MARK = /@(summary|recommendation|action)\.\s*/gi
const HAS_TRAIL = /@(summary|recommendation|action)\./i
/** The order closing lines are shown in. */
const CLOSING_KINDS = ['summary', 'recommendation', 'action']

function headNode(text, level) {
    const m = text.trim().match(HEAD_RE)
    let rest = m ? m[2] : text.trim()
    const tags = new Set()
    let option = ''
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) {
        const letter = t[1].match(OPTION_RE)
        if (letter) {
            option = letter[1].toUpperCase()
            tags.add('option')
        } else for (const name of TAG_NAMES[t[1].toLowerCase()] ?? [t[1].toLowerCase()]) tags.add(name)
    }
    // The title reads as outlines wrote it before the tag, `(A) Title`, so the page and the messages it sends name the option the same way.
    return { level, num: m ? m[1] : '', title: option ? `(${option}) ${rest.trim()}` : rest.trim(), option, tags, body: [], children: [] }
}

/** The outline as a tree of markdown tokens: the root holds any text before the first topic, and the topics. */
function parseOutline(source) {
    const tokens = md.parse(source, {})
    const root = { level: 0, num: '', title: '', tags: new Set(), body: [], children: [] }
    const stack = [root]
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t.type !== 'heading_open') {
            stack[stack.length - 1].body.push(t)
            continue
        }
        const node = headNode(tokens[i + 1].content, Number(t.tag.slice(1)))
        while (stack[stack.length - 1].level >= node.level) stack.pop()
        stack[stack.length - 1].children.push(node)
        stack.push(node)
        i += 2
    }
    return root
}

/** open, agent (a claim, or a node carrying a recommendation) or done (the user approved it). */
function statusOf(node) {
    if (node.tags.has('approved')) return 'done'
    if (node.tags.has('claim') || node.tags.has('recommended')) return 'agent'
    return node.body.some(t => t.type === 'inline' && REC_MARK.test(t.content)) ? 'agent' : 'open'
}

/** A paragraph's prose and its tagged closing lines. */
function splitTrail(text) {
    const parts = { prose: text, summary: '', recommendation: '', action: '' }
    const marks = [...text.matchAll(TRAIL_MARK)]
    if (!marks.length) return parts
    parts.prose = text.slice(0, marks[0].index).trim()
    marks.forEach((m, i) => {
        parts[m[1].toLowerCase()] = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length).trim()
    })
    return parts
}

const plainTitle = title => title.replace(/[*_`]/g, '')

/** An `@options` question with its options under it: the page shows it as one choice. */
// (a node whose children are lettered options, `@option_A`, is one even when its `@options` was dropped)
const isQuestion = node => node.children.length > 0 && (node.tags.has('options') || node.children.some(c => c.option))

/** The statuses under a node, of the nodes that hold one of their own: its leaves, and each question as one. */
function statusesUnder(node, seen = new Set()) {
    for (const n of node.children) {
        if (isQuestion(n)) seen.add(questionStatus(n))
        else if (n.children.length) statusesUnder(n, seen)
        else seen.add(statusOf(n))
    }
    return seen
}

/** A question is settled once an option is picked, whatever the other options show; until then its recommended option speaks for it. */
function questionStatus(node) {
    const seen = statusesUnder(node)
    return ['done', 'agent'].find(s => seen.has(s)) ?? 'open'
}

/**
 * Status counts for the outline list's progress bar, counted the way the page rolls statuses up (web/src/lib/status.ts):
 * over the nodes that hold a status of their own. A parent only shows its descendants' statuses, and a question counts
 * once, so the options that were not picked (the recommended one among them) do not stay behind as open or claimed.
 */
export function countCheckboxProgress(source) {
    const counts = { total: 0, done: 0, agent: 0, open: 0 }
    const count = status => {
        counts.total++
        counts[status]++
    }
    const walk = node =>
        node.children.forEach(n => {
            if (isQuestion(n)) count(questionStatus(n))
            else if (n.children.length) walk(n)
            else count(statusOf(n))
        })
    walk(parseOutline(source))
    return counts
}

const mdPlain = new MarkdownIt({ html: false, linkify: true })

/** Markdown as a plain preview (the Markdown tab, transcript messages). */
export function renderPlain(source) {
    return mdPlain.render(source)
}

/** The glossary's names for statusOf's values. */
const STATUS = { open: 'open', agent: 'claim', done: 'approved' }

/** A node's text as HTML, with its closing lines taken out of the paragraph that holds them. */
function bodyJson(tokens) {
    let html = ''
    let run = []
    const closing = []
    const flush = () => {
        if (run.length) html += md.renderer.render(run, md.options, {})
        run = []
    }
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t.type === 'paragraph_open' && t.level === 0 && HAS_TRAIL.test(tokens[i + 1].content)) {
            flush()
            const parts = splitTrail(tokens[i + 1].content)
            if (parts.prose) html += `<p>${md.renderInline(parts.prose)}</p>\n`
            for (const kind of CLOSING_KINDS) if (parts[kind]) closing.push({ kind, html: md.renderInline(parts[kind]) })
            i += 2
        } else run.push(t)
    }
    flush()
    closing.sort((a, b) => CLOSING_KINDS.indexOf(a.kind) - CLOSING_KINDS.indexOf(b.kind))
    return { html, closing }
}

function nodeJson(node) {
    const { html, closing } = bodyJson(node.body)
    return {
        num: node.num,
        level: node.level,
        tags: [...node.tags],
        status: STATUS[statusOf(node)],
        ...(node.option ? { option: node.option } : {}),
        title: plainTitle(node.title),
        titleHtml: md.renderInline(node.title),
        html,
        closing,
        children: node.children.map(nodeJson),
    }
}

/** The Markdown tab shows the source: an option's `@option_A` tag reads there as it does on the page, `(A)` before its title. */
function optionLetters(source) {
    let fence = false
    return source
        .split('\n')
        .map(line => {
            if (line.trimStart().startsWith('```')) fence = !fence
            if (fence) return line
            const m = line.match(/^(#{1,6} \d+(?:\.\d+)*\.?(?:\s+@[\w-]+)*?)\s+@option[_-]([a-z])\b(.*)$/i)
            if (!m) return line
            return `${m[1]} (${m[2].toUpperCase()})${m[3]}`.replace(/\s+$/, '')
        })
        .join('\n')
}

/** What the page shows of an outline (web/src/types.ts describes it): its header lines, nodes, queue and Markdown tab. */
export function outlinePayload(text) {
    const { source, ...headers } = extractHeaders(text)
    const root = parseOutline(source)
    return {
        ...headers,
        intro: md.renderer.render(root.body, md.options, {}),
        nodes: root.children.map(nodeJson),
        markdown: renderPlain(optionLetters(source)),
    }
}
