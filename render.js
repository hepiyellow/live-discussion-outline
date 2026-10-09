import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Chat bubble with an arrow: puts a reference to the item into the message box (pages linked to a session). */
const INSERT_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 2.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7.5L4.5 13.5V11h-2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M5 6.75h5M8.25 5 10 6.75 8.25 8.5"/></svg>'
/** Envelope: the agent's messages. */
const MAIL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="m2 4.5 6 4.5 6-4.5"/></svg>'
/** Play: runs an @action node. */
const PLAY_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>'
/** Pencil: renames the discussion. */
const PENCIL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L5.4 13.1l-3.1.6.6-3.1z"/><path d="M9.3 4.2l2.5 2.5"/></svg>'
const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10"/></svg>'

/**
 * The outline's nodes are its headings: `# 2. @approved Title` is a topic, `## 2.1 @claim @options Title` a node under
 * it, down to `######`. A node's text is everything up to the next heading, rendered as ordinary markdown (bullets
 * included). Status and the other tags sit on the heading line, right after the number.
 */
const HEAD_RE = /^(\d+(?:\.\d+)*)\.?(?:\s+|$)([\s\S]*)$/
const TAG_RE = /^@(approved|claim|options|recommended|current|action|ran)\b\s*/i
const REC_MARK = /@recommendation\./i
/** Tags that open a node's closing lines, after its prose: `@Summary.`, `@Recommendation.`, `@Action.` (in any order). */
const TRAIL_MARK = /@(summary|recommendation|action)\.\s*/gi
const HAS_TRAIL = /@(summary|recommendation|action)\./i

function headNode(text, level) {
    const m = text.trim().match(HEAD_RE)
    let rest = m ? m[2] : text.trim()
    const tags = new Set()
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) tags.add(t[1].toLowerCase())
    return { level, num: m ? m[1] : '', title: rest.trim(), tags, body: [], children: [] }
}

/** The outline as a tree: the root holds any text before the first topic, and the topics. */
export function parseOutline(source) {
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

const TRAIL_PILLS = {
    summary: '<span class="pill sum" title="A summary of this node\'s text">Summary</span>',
    recommendation: '<span class="pill rec" title="A recommendation for this node">💡 Recommendation</span>',
    action: `<span class="pill act" title="What running this action will do">${PLAY_ICON} Action</span>`,
}

/** A node's text as HTML; a paragraph holding closing lines shows each on its own line under its tag. */
function renderBody(tokens) {
    let html = ''
    let run = []
    const flush = () => {
        if (run.length) html += md.renderer.render(run, md.options, {})
        run = []
    }
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t.type === 'paragraph_open' && t.level === 0 && HAS_TRAIL.test(tokens[i + 1].content)) {
            flush()
            const parts = splitTrail(tokens[i + 1].content)
            if (parts.prose) html += `<p>${md.renderInline(parts.prose)}</p>`
            for (const kind of ['summary', 'recommendation', 'action'])
                if (parts[kind]) html += `<div class="rec-line">${TRAIL_PILLS[kind]} ${md.renderInline(parts[kind])}</div>`
            i += 2
        } else run.push(t)
    }
    flush()
    return html
}

const plainTitle = title => title.replace(/[*_`]/g, '')

/** Nodes below a topic become a table: number | title | text. Nodes with children get a nested table in a child row. */
function rowsHtml(nodes, radio = false) {
    // One <tbody> per row: it is the box a sticky parent row stays inside, until its last child has scrolled past.
    return `<table class="ol">\n${nodes.map(n => `<tbody>${rowHtml(n, radio)}</tbody>\n`).join('')}</table>\n`
}

/** radio: this node is one option of an `@options` question, so the viewer draws a radio button. */
function rowHtml(node, radio) {
    const { num, title, tags, children } = node
    const fileCheck = statusOf(node)
    const kids = children.length ? rowsHtml(children, tags.has('options')) : ''
    const group = Boolean(kids) && tags.has('options')
    const checked = fileCheck === 'done'
    const parts = num ? num.split('.') : []
    const chain = parts.map((_, n) => parts.slice(0, n + 1).join('.')).join(' › ')
    const label = `${num} ${plainTitle(title)}`.trim()
    const content = renderBody(node.body)
    const count = children.length
        ? `<span class="kc" role="button" tabindex="0" title="${children.length} direct child${children.length === 1 ? '' : 'ren'} — click the row to collapse or expand"><span>${children.length}</span></span>`
        : ''
    const pill = group
        ? '<span class="pill pick" title="Choose exactly one of the options below">◉ Pick one</span>'
        : !kids && tags.has('options')
          ? '<span class="pill opt" title="Options proposed, no recommendation yet">❓ Options</span>'
          : ''
    const recPill = radio && tags.has('recommended') ? '<span class="pill rec" title="The option the agent recommends">💡 Recommended</span>' : ''
    // An action the agent carries out when the user runs it: a play button until the agent marks it @ran.
    const action = tags.has('action') && !tags.has('ran')
    const ranPill = tags.has('ran') ? '<span class="pill ran" title="The agent carried out this action">Ran</span>' : ''
    const titleHtml = [md.renderInline(title), pill, recPill, ranPill].filter(Boolean).join(' ')
    const cls = ['r', tags.has('current') && 'cur', checked && 's-done', kids && checked && 'closed'].filter(Boolean).join(' ')
    const flags = (action ? ' data-action="1"' : '') + (group ? ' data-group="options"' : '') + (radio ? ' data-opt="1"' : '') + (radio && tags.has('recommended') ? ' data-rec="1"' : '')
    const boxTitle = radio
        ? fileCheck === 'done' ? 'Chosen' : fileCheck === 'agent' ? 'Recommended — click to choose it' : 'Choose this option'
        : fileCheck === 'done' ? 'Approved' : fileCheck === 'agent' ? 'Claim — click to queue your approval' : 'Approve this node'
    return (
        `<tr class="${cls}" data-num="${escapeHtml(num)}" data-ref="${escapeHtml(label)}" data-check="${fileCheck}"${flags}>` +
        `<td class="n" title="${escapeHtml(chain)}"><div class="nh"><span class="tri" aria-hidden="true">${kids ? '▼' : ''}</span><span class="nm">${escapeHtml(parts.length ? parts[parts.length - 1] : '')}</span><span class="nf">${escapeHtml(num)}</span>` +
        `<button class="ask" title="Open a side discussion on this node: copies its path (and any queued approvals)">${COPY_ICON}</button>${count}</div>` +
        `<div class="s">${action ? `<button class="play" type="button" title="Run this action: ask the agent to do it now">${PLAY_ICON}</button>` : ''}<input type="checkbox" class="ck${radio ? ' radio' : ''}"${fileCheck !== 'open' ? ' checked' : ''} title="${boxTitle}">` +
        `</div></td>` +
        (kids
            ? `<td class="t">${titleHtml}</td></tr>\n` + `<tr class="kids"><td colspan="3">${content ? `<div class="pc">${content}</div>` : ''}${kids}</td></tr>\n`
            : `<td class="t">${titleHtml}</td><td class="c">${content}</td></tr>\n`)
    )
}

/** A topic is a collapsible section; an approved one starts collapsed (the page restores the reader's own choices). */
function topicHtml(node) {
    const status = statusOf(node)
    const head = `${node.num ? `${node.num}. ` : ''}${node.title}`
    const cls = ['h h2', status === 'done' && 's-done', node.tags.has('current') && 'cur'].filter(Boolean).join(' ')
    return (
        `<details class="${cls}" data-key="${escapeHtml(plainTitle(head))}" data-check="${status}"${status === 'done' ? '' : ' open'}>\n` +
        `<summary>${md.renderInline(head)}</summary>\n<div class="body">\n${renderBody(node.body)}${node.children.length ? rowsHtml(node.children) : ''}</div></details>\n`
    )
}

/** The page's outline: the title, any text before the first topic, then the topics. */
export function renderMarkdown(source, title = '') {
    const root = parseOutline(source)
    return (title ? `<h1 data-title="${escapeHtml(title)}"><span class="tt">${md.renderInline(title)}</span><button class="rename" type="button" title="Rename this discussion" aria-label="Rename this discussion">${PENCIL_ICON}</button></h1>\n` : '') + renderBody(root.body) + root.children.map(topicHtml).join('')
}

/** Status counts over the nodes below the topics, for the index page's progress bar. */
function countCheckboxProgress(source) {
    const counts = { total: 0, done: 0, agent: 0, open: 0 }
    const walk = node => node.children.forEach(n => {
        if (n.level > 1) {
            counts.total++
            counts[statusOf(n)]++
        }
        walk(n)
    })
    walk(parseOutline(source))
    return counts
}

const mdPlain = new MarkdownIt({ html: false, linkify: true })

export function renderPlain(source) {
    return mdPlain.render(source)
}

/** `waitFor` (a tmux session name) makes the page for a session just started: only its terminal, until its outline exists. */
/** The queue's item kinds, each with a small icon for the left pane. */
const QUEUE_KINDS = {
    decide: { name: 'Decide', paths: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1"/>' },
    approve: { name: 'Approve', paths: '<circle cx="8" cy="8" r="6"/><path d="m5.4 8.2 1.8 1.8 3.4-3.6"/>' },
    action: { name: 'Run', paths: '<path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none"/>' },
    read: { name: 'Read', paths: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>' },
}

export function renderPage({ title, bodyHtml, tableHtml, plainHtml, resume, model, terminal, terminalTab, session, queue, project, folder, waitFor, storageKey }) {
    // The queue, in the left pane under the Discussions button: one small button per item, in the agent's order.
    const QUEUE = queue?.length
        ? `<hr class="rail-sep"><ol class="queue" aria-label="Your queue">${queue
              .map(({ num, kind, label }) => {
                  const k = QUEUE_KINDS[kind]
                  return `<li><button type="button" class="q q-${kind}" data-num="${escapeHtml(num)}" title="${escapeHtml(`${k.name} ${num}: ${label}`)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${k.paths}</svg><span>${escapeHtml(num)}</span></button></li>`
              })
              .join('')}</ol>`
        : ''
    const icon = paths => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
    const tabButton = (m, label, tip, paths) => `<button role="tab" data-m="${m}" aria-selected="${m === 'outline'}"${m === 'outline' ? ' class="on"' : ''} title="${escapeHtml(tip)}">${icon(paths)}<span class="tl">${label}</span></button>`
    const termTab = tabButton('term', 'Terminal', terminalTab ? `The session's live terminal (tmux ${terminal})` : 'Not running in tmux', '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5 6.5 8l-2 1.5M8 10.5h3.5"/>')
    const TABS = waitFor ? `<div id="tabs" role="tablist">${termTab}</div><span class="waiting">Waiting for the agent to write the outline…</span>` : `<div id="tabs" role="tablist">${[
        tabButton('outline', 'Outline', 'The collapsible outline', '<path d="M2 3.5h2M6.5 3.5H14M4.5 8h2M9 8h5M4.5 12.5h2M9 12.5h5"/>'),
        tabButton('md', 'Markdown', 'The plain rendered markdown', '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 10V6l2 2 2-2v4M11.5 6v4M10 8.5l1.5 1.5L13 8.5"/>'),
        tabButton('transcript', 'Transcript', session ? "The session's messages, rendered" : 'Not linked to a session yet', '<path d="M2.5 3h8a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H6L3.5 11.5V9.5h-1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 6.5v5H12v2l-2.5-2H7.5"/>'),
        termTab,
    ].join('')}</div>`
    // Model and effort: read from the outline's Model line ("Claude Sonnet 5.5, low"); changing one types /model or /effort into the session.
    const MODELS = [['claude-fable-5-1', 'Fable 5.1'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']]
    const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
    const modelNow = (MODELS.find(([, label]) => new RegExp(`\\b${label.split(' ')[0]}\\b`, 'i').test(model || '')) || [])[0] || ''
    const effortNow = ((model || '').match(/\b(low|medium|high|xhigh|max)\b/i) || [])[1]?.toLowerCase() || ''
    const pickTip = terminal
        ? `Sends /model or /effort to the session (tmux ${terminal}). Claude Code also saves the choice as your default for new sessions.`
        : 'Only for discussions running in tmux'
    const select = (id, now, options, placeholder) =>
        `<select id="${id}"${terminal ? '' : ' disabled'} title="${escapeHtml(pickTip)}" aria-label="${placeholder}">${now ? '' : `<option value="" selected>${placeholder}</option>`}${options.map(([v, l]) => `<option value="${v}"${v === now ? ' selected' : ''}>${l}</option>`).join('')}</select>`
    const MODEL_PICKER = `<span class="picker" data-line="${escapeHtml(model || '')}">${select('pick-model', modelNow, MODELS, 'Model')}${select('pick-effort', effortNow, EFFORTS.map(e => [e, e]), 'Effort')}</span>`
    // The project (workspace or repo) the discussion is about; the tooltip names the folder Claude runs in.
    const PROJECT = project
        ? `<span class="proj" title="${escapeHtml(`Project: ${project}${folder ? `\nWorking folder: ${folder}` : ''}`)}">${icon('<path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>')}${escapeHtml(project)}</span>`
        : ''
    const TRANSCRIPT_OFF =
        "This outline isn't linked to an agent session yet. With Claude Code, the skill writes a <code>Session:</code> line (the <code>session=</code> value <code>bin/ensure.js</code> prints); ask the agent to add it to this outline."
    const TERMINAL_OFF = terminal
        ? `The terminal can't be shown: the server couldn't load node-pty (see the server log). The Transcript tab can still type into tmux ${escapeHtml(terminal)}.`
        : "This discussion isn't running in tmux. Start the agent with <code>tmux new -s &lt;name&gt; claude</code> and run the skill; it adds a <code>Terminal:</code> line, and this tab shows that session's live terminal."
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--fire:#fff1e5;--fireline:var(--fg);--done:#8c959f;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--fire:#2d1b0e;--fireline:var(--fg);--done:#6e7681;--accent:#58a6ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{padding-left:76px}
.rail{position:fixed;top:0;bottom:0;left:0;width:76px;border-right:1px solid var(--line);background:var(--bg);display:flex;flex-direction:column;align-items:center;padding-top:8px;z-index:4}
.rail a{display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;padding:8px 0;border-radius:8px;color:var(--fg);background:none;border:1px solid var(--line);font-size:11px;text-decoration:none}
.rail a:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
.rail>a svg{width:28px;height:28px}
.rail{overflow-y:auto}
.rail-sep{width:40px;border:0;border-top:1px solid var(--line);margin:10px 0 8px;flex:none}
.queue{list-style:none;margin:0;padding:0 0 12px;display:flex;flex-direction:column;gap:4px;width:64px}
.queue li[hidden]{display:none}
.queue .q{box-sizing:border-box;width:64px;display:flex;align-items:center;gap:4px;padding:3px 5px;border:1px solid var(--line);border-radius:6px;background:none;color:var(--fg);font:11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;cursor:pointer}
.queue .q:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
.queue .q svg{width:12px;height:12px;flex:none}
.queue .q span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.queue .q-decide svg{color:#d1242f}
.queue .q-approve svg{color:var(--accent)}
.queue .q-read svg{color:var(--muted)}
.queue .q-action svg{color:#d1242f}
.queue .q-unread svg{color:var(--accent)}
.queue .q.missing{opacity:.5}
.rail .inbox-btn{flex:none;margin:auto 0 12px;width:64px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0 5px;border:1px solid var(--line);border-radius:8px;background:none;color:#d1242f;font:11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.rail .inbox-btn[hidden]{display:none}
.rail .inbox-btn:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
.inbox-btn .n,.msgs .n{min-width:14px;padding:0 4px;border-radius:8px;background:#d1242f;color:#fff;font-size:10px;line-height:14px;text-align:center}
.inbox-btn .n:empty,.msgs .n:empty{display:none}
/* A bullet's own envelope is muted (the left pane's stays red); on parent rows and topic headings it sits in the row's
   flow just before the roll-up icons, so it never covers them. */
.msgs{position:absolute;right:40px;top:8px;display:inline-flex;align-items:center;gap:3px;padding:2px 4px;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer;z-index:2}
.msgs .n{background:var(--muted);color:var(--bg)}
.msgs:hover{background:color-mix(in srgb,var(--fg) 12%,transparent)}
tr.r.parent .msgs,details.h>summary .msgs{position:static;flex:none}
body.bubbles table.ol tr.r.parent .msgs{grid-area:msg;margin:0 8px 0 0}
details.h>summary .msgs{margin:0 8px 0 auto}
details.h>summary .msgs+.cks-extra{margin-left:0}
.inbox{position:fixed;z-index:60;width:min(440px,calc(100vw - 100px));max-height:60vh;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:14px}
.inbox[hidden]{display:none}
.inbox h4{margin:0;padding:10px 14px 6px;font-size:13px;color:var(--muted);font-weight:600}
.inbox .msg{padding:8px 14px 10px;border-top:1px solid var(--line)}
.inbox .msg.unseen{box-shadow:inset 3px 0 0 #d1242f}
.inbox .msg .meta{display:flex;gap:8px;font-size:12px;color:var(--muted)}
.inbox .msg .meta a{color:var(--accent);cursor:pointer}
.inbox .msg p{margin:.3em 0}
.inbox .empty{padding:10px 14px;color:var(--muted)}
/* The item just opened from the queue: a left line in its kind's color, drawn like the current-item line, fading out. */
@keyframes qline{from{box-shadow:inset 3px 0 0 var(--qline)}to{box-shadow:inset 3px 0 0 transparent}}
@keyframes qline-row{from{box-shadow:inset 3px 0 0 var(--qline),0 1px 0 var(--line)}to{box-shadow:inset 3px 0 0 transparent,0 1px 0 var(--line)}}
body.bubbles table.ol tr.r:not(.parent).qmark::before,details.h>summary.qmark{animation:qline 1.6s ease-in forwards}
body.bubbles table.ol tr.r.parent.qmark{animation:qline-row 1.6s ease-in forwards}
main{max-width:860px;margin:0 auto;padding:16px 20px 80px}
.bar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px;display:flex;gap:8px;align-items:center;z-index:20}
.bar a,.bar button{font:inherit;font-size:13px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:3px 10px;cursor:pointer;text-decoration:none}
.bar .seg{display:inline-flex;padding:0;overflow:hidden}
.bar .seg span{padding:4px 10px;color:var(--muted);display:inline-flex;align-items:center}
.bar button.icon{display:inline-flex;align-items:center;padding:3px 6px}
.bar button.icon:disabled{opacity:.35;cursor:default}
.bar .seg span+span{border-left:1px solid var(--line)}
.bar .seg span.on{color:var(--fg);font-weight:700;box-shadow:inset 0 -2px 0 var(--fg)}
/* Browser-style tabs: they sit on the bar's bottom border, and the selected one opens into the page below. */
.bar #tabs{display:flex;gap:2px;align-self:flex-end;margin:0 6px -9px 0}
.bar #tabs [role=tab]{display:inline-flex;align-items:center;gap:6px;padding:6px 14px 7px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:none;color:var(--muted);font-size:13px;position:relative}
.bar #tabs [role=tab]:hover{color:var(--fg);background:color-mix(in srgb,var(--line) 35%,transparent)}
.bar #tabs [role=tab].on{color:var(--fg);font-weight:600;background:var(--bg);border-color:var(--line);box-shadow:0 1px 0 var(--bg);z-index:1}
#term.off,#transcript .note{color:var(--muted)}
#term.off{position:static;background:none;padding:16px 20px 80px;max-width:860px;margin:0 auto}
.bar .waiting{font-size:13px;color:var(--muted)}
.bar{flex-wrap:nowrap;white-space:nowrap}
.bar>*{flex-shrink:0}
.bar .more{margin-left:auto;font-size:16px;line-height:1;padding:2px 8px}
.bar .picker+.more{margin-left:0}
.bar .menu{position:absolute;right:12px;top:calc(100% + 4px);display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:30}
.bar .menu[hidden],.bar .more[hidden]{display:none}
.bar .menu .picker{margin-left:0}
.bar.compact #tabs [role=tab]:not(.on) .tl{display:none}
.bar.compact #tabs [role=tab]{padding-left:10px;padding-right:10px}
.bar .picker{margin-left:auto;display:inline-flex;gap:6px}
.bar .proj{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis}
.bar .proj+.picker,.bar .menu .proj{margin-left:0}
.bar select{font:inherit;font-size:13px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:3px 6px;cursor:pointer}
.bar select:disabled{color:var(--muted);cursor:default}
#outline>h1,#outline-table>h1{font-size:1.85em;font-weight:700;line-height:1.2;margin:0 0 .85em;letter-spacing:-.02em}
h1 .rename{display:inline-flex;align-items:center;vertical-align:middle;margin-left:10px;padding:4px;color:var(--muted);background:none;border:1px solid transparent;border-radius:6px;cursor:pointer;opacity:.6}
h1 [hidden]{display:none}
h1 .rename:hover,h1 .rename:focus-visible{opacity:1;color:var(--fg);border-color:var(--line)}
h1 input.rename-in{font:inherit;letter-spacing:inherit;color:var(--fg);background:var(--bg);width:100%;box-sizing:border-box;padding:0 6px;margin:-1px -7px;border:1px solid var(--line);border-radius:6px}
h1 input.rename-in:disabled{opacity:.6}
h1 .rename-err{display:block;font-size:13px;font-weight:400;letter-spacing:0;color:#d1242f;margin-top:4px}
details{margin:4px 0}
details>summary{cursor:pointer;padding:3px 6px;border-radius:6px;list-style:none}
details>summary::before,table.ol .tri{content:'▼';display:inline-block;width:16px;margin-right:6px;text-align:center;color:var(--muted);font-size:13px;line-height:1;user-select:none}
details:not([open])>summary::before{transform:rotate(-90deg)}
details>summary:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
details>summary h2,details>summary h3,details>summary h4{display:inline;margin:0;font-size:inherit}
details.h2>summary{font-size:1.1em;font-weight:600}
details.h3>summary{font-weight:600}
.body,details.li>:not(summary){margin-left:20px;padding-left:12px;border-left:1px solid var(--line)}
.body p,.body li{margin:3px 0}
ul,ol{padding-left:22px;margin:3px 0}
li details.li{margin-left:-4px}
code{background:color-mix(in srgb,var(--line) 50%,transparent);padding:1px 5px;border-radius:4px;font-size:.92em}
pre{background:color-mix(in srgb,var(--line) 35%,transparent);padding:10px 12px;border-radius:8px;overflow:auto}
pre code{background:none;padding:0}
details.s-fire>summary{background:var(--fire);border-left:3px solid var(--fireline)}
details.s-done>summary{color:var(--done)}
body.only-open details.s-done{display:none}
table.ol,table.ol>tbody,table.ol tr.kids,table.ol tr.kids>td{display:block}
table.ol{width:100%}
table.ol tr.r{display:grid;grid-template-columns:96px 26% minmax(0,1fr);min-height:var(--rh)}
table.ol tr.r>td{min-width:0}
table.ol tr.r.parent>td.t{grid-column:2/-1}
table.ol .tri{flex:none}
table.ol tr.closed .tri{transform:rotate(-90deg)}
table.ol .pc{margin-left:96px;padding:4px 8px}
:root{--rh:32px;--barh:44px}
details.h>summary,table.ol tr.r.parent{position:sticky;top:var(--top,calc(var(--barh) + var(--d,0) * var(--rh)));background:var(--bg);z-index:1}
details.h>summary{box-sizing:border-box;min-height:var(--rh);border-bottom:1px solid var(--line);border-radius:0;display:flex;align-items:center}
details.h>summary>h2,details.h>summary>h3,details.h>summary>h4{flex:0 1 auto}
details.h>summary>input.ck{order:-1;margin:0 12px 0 0;flex:none}
details.h>summary>.cks-extra{margin-left:auto}
body.bubbles details.h>summary{padding-left:12px}
body.bubbles .body{margin-left:0;padding-left:0}
details.h>summary.stuck{height:var(--rh);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
table.ol tr.r.stuck{box-sizing:border-box;height:var(--rh);overflow:hidden;box-shadow:0 1px 0 var(--line)}
table.ol tr.r.stuck>td.t,table.ol tr.r.stuck>td.c{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.ol td{vertical-align:top;padding:4px 8px;border-bottom:1px solid var(--line)}
table.ol td.n{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums;padding-right:8px}
table.ol .nh{display:flex;align-items:center;gap:2px}
table.ol .s{display:flex;align-items:center;margin-top:3px;min-height:14px}
table.ol td.t{font-weight:600;padding-left:4px}
table.ol tr.kids>td{border-bottom:0;padding:0 0 4px 20px}
/* Nodes right under a topic get the same indent as nested ones, so a diff button has room left of them. */
body.bubbles .body>table.ol{padding-left:20px}
table.ol table.ol{border-left:2px solid var(--line)}
table.ol tr.parent{cursor:pointer}
table.ol .kc{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;margin-left:2px;border:1.5px solid var(--muted);border-radius:50%;color:var(--muted);vertical-align:middle;user-select:none}
table.ol .kc>span{font-size:.7em;font-variant-numeric:tabular-nums;line-height:1}
table.ol tr.closed .kc{background:var(--muted);color:var(--bg)}
table.ol tr.closed+tr.kids{display:none}
body.bubbles table.ol td{border-bottom:0}
body.bubbles table.ol tr.r:not(.parent){position:relative;margin:6px 0;grid-template-columns:28px auto minmax(0,1fr) auto;grid-template-areas:"ck num title ask" "ck body body body";align-items:baseline}
body.bubbles table.ol tr.r:not(.parent)::before{content:'';grid-area:1/2/3/5;align-self:stretch;border-radius:16px;background:color-mix(in srgb,var(--line) 35%,transparent)}
body.bubbles table.ol tr.r:not(.parent).s-fire::before{box-shadow:inset 3px 0 0 var(--fireline)}
body.bubbles table.ol tr.r.parent.s-fire,body.bubbles table.ol tr.r.parent.s-fire.stuck{box-shadow:inset 3px 0 0 var(--fireline),0 1px 0 var(--line)}
body.bubbles table.ol tr.s-fire>td{background:none}
body.bubbles table.ol tr.r{padding-left:12px}
body.bubbles table.ol tr.r:not(.parent)>td.n,body.bubbles table.ol tr.r:not(.parent) .nh,body.bubbles table.ol tr.r:not(.parent) .s{display:contents}
body.bubbles table.ol tr.r:not(.parent)>td{background:none;position:relative}
body.bubbles table.ol tr.r:not(.parent) .tri,body.bubbles table.ol tr.r:not(.parent) .nm,body.bubbles table.ol tr.r:not(.parent) .st,body.bubbles table.ol tr.r:not(.parent) .cks-extra{display:none}
body.bubbles table.ol tr.r:not(.parent) .ck{grid-area:ck;align-self:start;margin:12px 0 0;width:16px;height:16px}
body.bubbles table.ol tr.r:not(.parent) .nf{display:inline;grid-area:num;position:relative;padding:10px 0 0 14px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
body.bubbles table.ol tr.r:not(.parent)>td.t{grid-area:title;padding:10px 8px 0}
body.bubbles table.ol tr.r:not(.parent) .ask{grid-area:ask;align-self:start;position:relative;margin:8px 10px 0 0}
body.bubbles table.ol tr.r:not(.parent):hover .ask{opacity:1}
body.bubbles table.ol tr.r:not(.parent)>td.c{grid-area:body;padding:2px 14px 10px;color:var(--muted)}
body.bubbles table.ol tr.r:not(.parent).s-done>td.c{color:var(--done)}
table.ol .nf{display:none}
body.bubbles table.ol table.ol{border-left:0}
body.bubbles .body{border-left:0}
body.bubbles table.ol tr.r.parent{grid-template-columns:28px 22px auto minmax(0,max-content) auto minmax(0,1fr) auto auto auto;grid-template-areas:"ck tri num title ask . msg kc tags";align-items:center;border-bottom:1px solid var(--line);margin:0}
body.bubbles table.ol tr.r.parent>td.n,body.bubbles table.ol tr.r.parent .nh,body.bubbles table.ol tr.r.parent .s{display:contents}
body.bubbles table.ol tr.r.parent>td{background:none;padding-top:6px;padding-bottom:6px}
body.bubbles table.ol tr.r.parent .ck:not(.tagico){grid-area:ck;justify-self:start;margin:0;width:16px;height:16px}
body.bubbles table.ol tr.r.parent .tri{grid-area:tri;justify-self:center;margin:0}
body.bubbles table.ol tr.r.parent .nm{display:none}
body.bubbles table.ol tr.r.parent .nf{display:inline;grid-area:num;padding-left:6px;color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums}
body.bubbles table.ol tr.r.parent>td.t{grid-area:title;padding-left:8px;padding-right:0}
body.bubbles table.ol tr.r.parent .ask{grid-area:ask;margin-left:6px}
body.bubbles table.ol tr.r.parent .kc{grid-area:kc;margin:0 8px 0 0}
body.bubbles table.ol tr.r.parent .cks-extra{grid-area:tags;margin:0 10px 0 0}
body.bubbles table.ol tr.r.parent.stuck{height:auto}
body.bubbles .pc{margin-left:56px;padding:4px 14px 4px 0}
table.ol tr.s-fire>td{background:var(--fire)}
table.ol tr.s-fire>td.n{border-left:3px solid var(--fireline)}
table.ol tr.s-done>td{color:var(--done)}
body.only-open table.ol tr.s-done,body.only-open table.ol tr.s-done+tr.kids{display:none}
table.ol .ask{margin-left:6px}
table.ol tr.s-done .ask{color:var(--done)}
:is(table.ol,details.h>summary) .ck{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:14px;height:14px;margin:0 4px 0 0;vertical-align:-2px;cursor:pointer;border:1.5px solid var(--muted);border-radius:3px;background:transparent center/11px 11px no-repeat;display:inline-block}
:is(table.ol,details.h>summary) .ck:checked,:is(table.ol,details.h>summary) .ck.on{border-color:#2da44e;background-color:#2da44e;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='white' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
:is(table.ol,details.h>summary) .ck.agent:checked,:is(table.ol,details.h>summary) .ck.agent.on{border-color:var(--accent);background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%230969da' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){:is(table.ol,details.h>summary) .ck.agent:checked,:is(table.ol,details.h>summary) .ck.agent.on{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%2358a6ff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}}
:is(table.ol,details.h>summary) .ck.pending:checked,:is(table.ol,details.h>summary) .ck.pending.on{border-color:#2da44e;background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%232da44e' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
:is(table.ol,details.h>summary) .ck.radio{border-radius:50%}
:is(table.ol,details.h>summary) .ck.radio:checked,:is(table.ol,details.h>summary) .ck.radio.on{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='white'/%3E%3C/svg%3E")}
:is(table.ol,details.h>summary) .ck.radio.agent:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%230969da'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){:is(table.ol,details.h>summary) .ck.radio.agent:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%2358a6ff'/%3E%3C/svg%3E")}}
:is(table.ol,details.h>summary) .ck.radio.pending:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%232da44e'/%3E%3C/svg%3E")}
:is(table.ol,details.h>summary) .ck.mixed{border-color:var(--muted);background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 6h6' fill='none' stroke='%238d96a0' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E")}
:is(table.ol,details.h>summary) .tagico{pointer-events:none;width:12px;height:12px;margin:0 0 0 3px;background-size:9px 9px;border-width:1.5px}
:is(table.ol,details.h>summary) .ck:not(.tagico){transition:box-shadow .04s linear,border-color .04s linear}
:is(table.ol,details.h>summary) .ck:not(.tagico):hover{box-shadow:0 0 0 4px color-mix(in srgb,var(--fg) 16%,transparent);border-color:var(--fg)}
:is(table.ol,details.h>summary) .ck:not(.tagico):hover:checked{border-color:inherit}
:is(table.ol,details.h>summary) .tagico{cursor:default}
:is(table.ol,details.h>summary) .ck:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
:is(table.ol,details.h>summary) .cks-extra{display:inline-flex;align-items:center;vertical-align:middle}
:is(table.ol,details.h>summary) .ck.echo{cursor:pointer}
:is(table.ol,details.h>summary) .ck.rolled{position:absolute;width:1px;height:1px;opacity:0;margin:0;pointer-events:none}
table.ol .pill{display:inline-block;margin-left:6px;font-size:11px;font-weight:500;border-radius:10px;padding:0 7px;white-space:nowrap;vertical-align:1px;cursor:default;user-select:none}
.pill.sum,.pill.act,.pill.rec{display:inline-block;font-size:11px;font-weight:500;border-radius:10px;padding:0 7px;white-space:nowrap;vertical-align:1px}
.pill.sum{color:var(--fg);background:color-mix(in srgb,var(--fg) 12%,transparent)}
.pill.act{color:#d1242f;background:color-mix(in srgb,#d1242f 14%,transparent)}
.pill.act svg{width:9px;height:9px;vertical-align:-1px}
.pill.rec{color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
table.ol .pill.sum{color:var(--fg);background:color-mix(in srgb,var(--fg) 12%,transparent)}
table.ol .pill.act{color:#d1242f;background:color-mix(in srgb,#d1242f 14%,transparent)}
table.ol .pill.act svg{width:9px;height:9px;vertical-align:-1px}
table.ol .pill.rec{color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.rec-line{display:block;margin-top:6px}
.rec-line .pill{margin:0 6px 0 0}
/* A node's text is block markdown (paragraphs, bullets, code): no outer margins inside its cell. */
table.ol :is(td.c,.pc)>:first-child{margin-top:0}
table.ol :is(td.c,.pc)>:last-child{margin-bottom:0}
table.ol :is(td.c,.pc) :is(p,ul,ol,pre){margin:.4em 0}
table.ol :is(td.c,.pc) :is(ul,ol){padding-left:1.4em}
table.ol .pill.opt{color:#d1242f;background:color-mix(in srgb,#d1242f 14%,transparent)}
table.ol tr.r .play{position:absolute;left:-20px;top:10px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:none;color:#d1242f;cursor:pointer}
table.ol tr.r.parent .play{top:50%;transform:translateY(-50%)}
table.ol tr.r .play:hover{background:color-mix(in srgb,#d1242f 18%,transparent)}
table.ol tr.r .play.sent{color:var(--muted);cursor:default;animation:playwait 1.4s ease-in-out infinite}
@keyframes playwait{50%{opacity:.35}}
table.ol tr.r[data-action]{position:relative}
table.ol tr.r.parent[data-action]{position:sticky}
/* The diff button is the checkbox's height and sits in the 20px indent of nested rows: from the parent's left edge to
   4px before the row's own edge, so a sticky header above covers it whole or not at all. */
table.ol tr.r .env{position:absolute;left:-20px;top:12px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent);cursor:pointer}
table.ol tr.r .env svg{width:11px;height:11px}
table.ol tr.r.parent .env{top:50%;transform:translateY(-50%)}
table.ol tr.r[data-action] .env{left:-40px}
table.ol tr.r .env.pulse{animation:envpulse .5s ease-in-out 3}
@keyframes envpulse{50%{transform:scale(1.5);background:color-mix(in srgb,var(--accent) 25%,transparent)}}
table.ol tr.r.parent .env.pulse{animation:envpulse-p .5s ease-in-out 3}
@keyframes envpulse-p{50%{transform:translateY(-50%) scale(1.5);background:color-mix(in srgb,var(--accent) 25%,transparent)}}
table.ol tr.r .env:hover{background:color-mix(in srgb,var(--accent) 38%,transparent)}
/* The diff animation: words are units (a word and the space after it) that grow in or collapse one by one while a cursor passes. */
.tx-u{display:inline-block;white-space:pre;overflow:clip;vertical-align:baseline}
.tx-n .tx-u:not(.on){display:none}
.tx-n .tx-u.on{animation:txadd 1s ease-out forwards}
.tx-n.c .tx-u.on{animation:txchg 1s ease-out forwards}
.tx-o .tx-u{color:#d1242f;background:color-mix(in srgb,#d1242f 18%,transparent)}
.tx-hide{display:none!important}
.tx-cur{position:fixed;left:0;top:0;width:2px;margin-left:-1px;border-radius:1px;background:var(--accent);box-shadow:0 0 6px var(--accent);pointer-events:none;z-index:60;transition:transform .07s linear,height .07s linear,opacity .15s}
@keyframes txadd{from{background:color-mix(in srgb,#2da44e 50%,transparent)}to{background:transparent}}
@keyframes txchg{from{background:color-mix(in srgb,var(--fg) 35%,transparent)}to{background:transparent}}
table.ol .pill.ran{color:var(--muted);background:color-mix(in srgb,var(--fg) 10%,transparent)}
table.ol .pill.pick{color:var(--fg);background:color-mix(in srgb,var(--fg) 12%,transparent)}
@media (prefers-color-scheme:dark){table.ol .pill.pick{color:#fff;background:color-mix(in srgb,#fff 16%,transparent)}}
/* Above the sticky headers (z-index up to 10, set by the script) that scroll under it; below the top bar (20). */
#status{position:fixed;left:76px;right:0;bottom:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 20px;background:var(--bg);border-top:1px solid var(--line);z-index:15}
.toast{position:fixed;transform:translate(-50%,-100%);background:var(--fg);color:var(--bg);font-size:12px;padding:3px 8px;border-radius:6px;pointer-events:none;z-index:50;white-space:nowrap}
#status[hidden]{display:none}
#status .tag{font-size:12px;border:1px solid #2da44e;background:#2da44e;color:#fff;border-radius:12px;padding:1px 4px 1px 9px;display:inline-flex;gap:4px;align-items:center}
#status .tag.reopen{background:transparent;color:#2da44e}
#status .tag button{border:0;background:none;color:inherit;cursor:pointer;font-size:13px;padding:0 3px}
#status .grow{flex:1}
#status .clearall{font:inherit;font-size:13px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
#status .clearall:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
#status .copyall{font:inherit;font-size:13px;color:#0d1117;background:#fff;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
table.ol tr:hover>td.n .ask,table.ol .ask:focus{opacity:1}
table.index{width:100%;border-collapse:collapse}
table.index th{text-align:left;color:var(--muted);font-weight:600;font-size:13px;padding:6px 10px;border-bottom:1px solid var(--line)}
table.index td{padding:8px 10px;border-bottom:1px solid var(--line)}
table.index td:last-child,table.index th:last-child{white-space:nowrap;color:var(--muted);text-align:right}
table.index tr[data-href]{cursor:pointer}
table.index td.progress-cell{padding:0}
table.index .progress{display:flex;align-items:center;gap:10px;white-space:nowrap}
table.index .copy{font-size:13px;border:1px solid var(--line);border-radius:6px;background:none;cursor:pointer;padding:1px 7px}
table.index .meter{flex:none;display:flex;width:120px;height:8px;background:var(--line);overflow:hidden}
table.index .meter>span{flex:none;height:100%}
table.index .meter .human{background:#2da44e}
table.index .meter .agent{background:var(--accent)}
table.index .nums{font-size:13px;color:var(--muted)}
table.index .nums .agent-n{color:var(--accent)}
table.index tr[data-href]:hover,table.index tr[data-href]:focus{background:color-mix(in srgb,var(--line) 40%,transparent);outline:none}
#plain{display:none}
body.show-md #plain{display:block}
body.show-md #outline,body.show-md #outline-table,body.show-md .outline-only{display:none}
body.has-table #outline{display:none}
#term{display:none;position:fixed;top:var(--barh);left:76px;right:0;bottom:0;padding:6px 0 0 8px;background:#0d1117}
body.show-term #term,body.show-transcript #transcript{display:block}
:is(body.show-term,body.show-transcript) :is(#outline,#outline-table,#plain,.outline-only,#status){display:none}
#transcript{display:none;padding-top:0;padding-bottom:140px}
#transcript .ttitle{position:sticky;top:var(--barh);z-index:2;background:var(--bg);padding:14px 0 10px;border-bottom:1px solid var(--line);font-size:1.4em;font-weight:700;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#transcript .m{margin:10px 0}
#transcript .m.u{white-space:pre-wrap;background:color-mix(in srgb,var(--accent) 10%,transparent);border-radius:10px;padding:8px 12px}
#transcript .m.u .via{display:block;font-size:12px;color:var(--muted)}
#transcript .m.a p{margin:.5em 0}
#transcript a{color:var(--accent)}
#transcript .m.sys{color:var(--muted);font:12px/1.4 Menlo,monospace}
#transcript details.tool{margin:1px 0;font-size:13px;color:var(--muted)}
#transcript details.tool>summary{padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#transcript details.tool .tn{font-weight:600;color:var(--fg)}
#transcript details.tool pre{margin:4px 0 6px 28px;max-height:320px;font-size:12px;white-space:pre-wrap;word-break:break-word}
#transcript pre.tr.err{color:#d1242f}
#transcript .note{color:var(--muted)}
#composer{position:fixed;left:76px;right:0;bottom:0;display:flex;gap:8px;align-items:flex-end;padding:10px 20px;background:var(--bg);border-top:1px solid var(--line);z-index:15}
body.show-term #composer{display:none}
/* The send notice: over the message box (above everything else), sliding in from the send button's side. */
#notice{position:fixed;right:64px;bottom:12px;max-width:min(520px,calc(100vw - 180px));z-index:100;padding:8px 14px;border-radius:10px;background:var(--fg);color:var(--bg);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 20px rgba(0,0,0,.3);transform:translateX(calc(100% + 84px));opacity:0;transition:transform .3s ease,opacity .3s ease;pointer-events:none}
#notice.show{transform:none;opacity:1}
#notice.error{background:#d1242f;color:#fff}
#composer .box{flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;padding:4px 6px}
#composer .box:focus-within{border-color:var(--muted)}
#composer textarea{font:inherit;color:var(--fg);background:none;border:0;outline:none;padding:3px 8px;resize:none;max-height:40vh;line-height:1.45}
#composer .spin{flex:none;align-self:center;box-sizing:border-box;width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;visibility:hidden}
#composer .spin.on{visibility:visible;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#composer .cmds{position:absolute;left:20px;right:64px;bottom:calc(100% + 6px);max-height:min(320px,50vh);overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);padding:4px}
#composer .cmds[hidden]{display:none}
#composer .cmd{padding:5px 10px;border-radius:6px;cursor:pointer}
#composer .cmd.on{background:color-mix(in srgb,var(--accent) 18%,transparent)}
#composer .cmd b{font-weight:600}
#composer .cmd .hint{color:var(--muted);font-size:12px}
#composer .cmd .desc{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#composer .chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 2px 0}
#composer .chips:empty{display:none}
#composer .chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;font-size:12px;color:var(--fg);background:color-mix(in srgb,var(--line) 55%,transparent);border-radius:10px;padding:1px 2px 1px 9px}
#composer .chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#composer .chip button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0 4px}
#composer .chip button:hover{color:var(--fg)}
#composer .chip.go{cursor:pointer}
#composer .chip.go:hover{background:color-mix(in srgb,var(--line) 90%,transparent)}
#composer .send{flex:none;width:34px;height:34px;border-radius:50%;border:0;background:var(--accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
#composer .send:disabled{opacity:.4;cursor:default}
/* With the message box, page content and the approvals bar sit above it. */
body:has(#composer):not(.show-term) main{padding-bottom:calc(var(--composer-h,60px) + 80px)}
body:has(#composer):not(.show-term) #status{bottom:var(--composer-h,60px)}
#plain h1,#plain h2,#plain h3{margin:1.2em 0 .5em;line-height:1.25}
#plain h2{border-bottom:1px solid var(--line);padding-bottom:.25em}
#plain ul{list-style:disc}
#plain p{margin:.6em 0}
.ask{color:var(--muted);margin-left:8px;opacity:.7;border:0;border-radius:6px;background:none;cursor:pointer;padding:2px 4px;display:inline-flex;align-items:center;vertical-align:middle;line-height:1}
.ask:hover{color:var(--fg);background:color-mix(in srgb,var(--line) 40%,transparent)}
summary:hover .ask,li:hover>.ask,.ask:focus{opacity:1}
</style></head><body${tableHtml === undefined ? '' : ' class="has-table bubbles"'}>
<nav class="rail"><a href="/" title="All outlines"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Discussions</a>${QUEUE}${session && !waitFor ? `<button id="inbox-open" class="inbox-btn" type="button" title="Messages from the agent" hidden>${MAIL_ICON}<span class="n"></span></button>` : ''}</nav>${session && !waitFor ? '<div id="inbox" class="inbox" role="dialog" aria-label="Messages" hidden></div>' : ''}
<div class="bar">${plainHtml === undefined ? '' : TABS}<button id="expand" class="outline-only icon" title="Expand all" aria-label="Expand all"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1"/><rect x="2" y="5" width="9" height="9" rx="1"/><path d="M4.5 9.5h4M6.5 7.5v4"/></svg></button><button id="collapse" class="outline-only icon" title="Collapse all" aria-label="Collapse all"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1"/><rect x="2" y="5" width="9" height="9" rx="1"/><path d="M4.5 9.5h4"/></svg></button><button id="fire" class="outline-only icon" title="Jump to the current node" aria-label="Jump to the current node"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg></button>${tableHtml === undefined ? '' : '<button id="undo" class="outline-only icon" type="button" disabled aria-label="Undo your last approval"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6h7a4 4 0 0 1 0 8H7"/></svg></button>'}${PROJECT}${plainHtml === undefined ? '' : MODEL_PICKER}</div>
${bodyHtml === undefined ? '' : `<main id="outline">${bodyHtml}</main>`}${tableHtml === undefined ? '' : `<main id="outline-table">${tableHtml}</main>`}${plainHtml === undefined ? '' : `<main id="plain">${plainHtml}</main>`}${plainHtml === undefined ? '' : terminalTab ? '<div id="term"></div>' : `<main id="term" class="off"><p class="note">${TERMINAL_OFF}</p></main>`}${plainHtml === undefined || waitFor ? '' : session ? `<main id="transcript"><div class="ttitle" id="ttitle">Untitled</div><div id="tlog"><p class="note">Loading the transcript…</p></div></main>` : `<main id="transcript"><p class="note">${TRANSCRIPT_OFF}</p></main>`}${plainHtml === undefined || waitFor || !terminal ? '' : `<form id="composer"><div id="cmds" class="cmds" role="listbox" aria-label="Slash commands" hidden></div><span class="spin" id="spin" role="status" title="The agent is working"></span><div class="box"><div class="chips" id="chips"></div><textarea id="msg" rows="1" placeholder="Message the session · Enter sends, Shift+Enter adds a line" title="Typed into tmux ${escapeHtml(terminal)}"></textarea></div><button class="send" title="Send" aria-label="Send"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg></button></form>`}<div id="status" hidden></div>
<script>
const KEY=${JSON.stringify(storageKey)};
const COPY_ICON=${JSON.stringify(COPY_ICON)};
const TERMINAL=${JSON.stringify(terminal || '')};
const SESSION=${JSON.stringify(session || '')};
// With a linked session (the message box exists), approvals go to the session by themselves and the row buttons put a
// reference into the message box. Without one, both go to the clipboard.
const LINKED=!!document.getElementById('composer');
// References name the outline by its title (its "# " line), not its file name.
const DOC_TITLE=(document.querySelector('#outline-table>h1,#outline>h1')||{}).textContent||document.title;
const OUTLINE=${JSON.stringify(project ? { project, file: title } : null)};
// The pencil beside the title edits it in place: Enter saves (the server rewrites the outline's Title: line), Escape cancels.
document.querySelectorAll('h1 .rename').forEach(btn=>{
  const h1=btn.closest('h1'),tt=h1.querySelector('.tt');
  btn.onclick=()=>{
    if(!OUTLINE)return;
    const input=document.createElement('input'),err=document.createElement('span');
    input.className='rename-in';input.type='text';input.maxLength=300;input.value=h1.dataset.title;input.setAttribute('aria-label','Discussion name');
    err.className='rename-err';err.hidden=true;
    let busy=false,done=false;
    const close=()=>{done=true;input.remove();err.remove();tt.hidden=false;btn.hidden=false;btn.focus()};
    const save=async()=>{
      if(busy||done)return;
      const name=input.value.trim();
      if(!name||name===h1.dataset.title)return close();
      busy=true;input.disabled=true;
      try{
        const r=await fetch('/api/rename',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({project:OUTLINE.project,file:OUTLINE.file,title:name})});
        if(!r.ok)throw new Error((await r.json()).error||'Not renamed');
        h1.dataset.title=name;tt.textContent=name;close();
      }catch(e){busy=false;input.disabled=false;err.textContent=e.message;err.hidden=false;input.focus()}};
    input.onkeydown=e=>{
      if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save()}
      else if(e.key==='Escape'){e.preventDefault();close()}};
    input.onblur=save;
    tt.hidden=true;btn.hidden=true;h1.append(input,err);input.focus();input.select()}});
const INSERT_ICON=${JSON.stringify(INSERT_ICON)};
// Linked, the reference becomes a chip in the message box (label: the item's number path and title); the full
// reference line is what gets sent. Unlinked, the reference is copied, with " — " to type after.
const refOut=(ref,btn,label)=>{if(!LINKED){try{navigator.clipboard.writeText(ref+' — ')}catch(e){}toast(btn);return}
  addChip(label,ref);toast(btn,'Added to the message box')};
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}};
const state=load();
const path=d=>{const k=[];for(let e=d;e;e=e.parentElement&&e.parentElement.closest('details'))k.unshift(e.dataset.key);return k.join(' > ')};
document.querySelectorAll('details').forEach(d=>{const s=state[path(d)];if(s!==undefined)d.open=s;
  d.addEventListener('toggle',()=>{state[path(d)]=d.open;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}})});

document.querySelectorAll('details>summary').forEach(sm=>{const b=document.createElement('button');b.className='ask';b.innerHTML=COPY_ICON;b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=sm.parentElement;refOut('Re: outline "'+DOC_TITLE+'" › '+path(d).split(' > ').join(' › '),b,d.dataset.key)};
  sm.appendChild(b)});
document.querySelectorAll('#outline li').forEach(li=>{if(li.querySelector(':scope>details'))return;
  const b=document.createElement('button');b.className='ask';b.innerHTML=COPY_ICON;b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=li.closest('details');const own=[...li.childNodes].filter(n=>!/^(UL|OL|BUTTON)$/.test(n.nodeName)).map(n=>n.textContent).join('').trim();
    refOut('Re: outline "'+DOC_TITLE+'" › '+(d?path(d).split(' > ').join(' › ')+' › ':'')+own,b,own)};
  li.insertBefore(b,li.querySelector(':scope>ul,:scope>ol'))});
const headPath=el=>{const d=el.closest('details');return d?path(d).split(' > ').join(' › ')+' › ':''};
const toast=(el,text='Copied to clipboard')=>{document.querySelectorAll('.toast').forEach(t=>t.remove());const t=document.createElement('div');t.className='toast';t.textContent=text;
  const r=el.getBoundingClientRect();t.style.left=r.left+r.width/2+'px';t.style.top=r.top-6+'px';document.body.appendChild(t);setTimeout(()=>t.remove(),2000)};
const rowKey=r=>'row:'+(r.dataset.num||r.dataset.ref);
const lsGet=k=>{try{return JSON.parse(localStorage.getItem(KEY+k)||'{}')}catch(e){return {}}};
const lsSet=(k,v)=>{try{localStorage.setItem(KEY+k,JSON.stringify(v))}catch(e){}};
const chk=lsGet(':chk'),sent=lsGet(':sent');   // chk: viewer overrides of the file's checkbox; sent: overrides already copied
const backTo=lsGet(':backto');   // nodes an undo reopens that were claims: sent as "Back to claim" instead of "Reopened"
const rows=[...document.querySelectorAll('tr.r')];
// Unread: a bullet the agent rewrote since you last saw it keeps showing what you saw, with an envelope left of its
// checkbox, so new answers don't push the page around. Opening it (the envelope, or its item in the left pane) animates
// the bubble to the new text. What you have seen is kept per outline; the first visit counts everything as seen.
// ':seen2': the nodes-as-headings format renders differently, so what was seen in the old format is dropped.
const SEEN=KEY+':seen2',SEP='\\u0001';try{localStorage.removeItem(KEY+':seen')}catch(e){}
let seen=null;try{seen=JSON.parse(localStorage.getItem(SEEN)||'null')}catch(e){}
const saveSeen=()=>{try{localStorage.setItem(SEEN,JSON.stringify(seen))}catch(e){}};
const cellsOf=r=>{const k=r.nextElementSibling;return [r.querySelector('td.t'),r.querySelector('td.c')||(k&&k.classList.contains('kids')?k.querySelector(':scope>td>.pc'):null)].filter(Boolean)};
const contentOf=r=>cellsOf(r).map(c=>c.innerHTML).join(SEP);
const setContent=(r,text)=>{const parts=text.split(SEP),cells=cellsOf(r);if(parts.length===cells.length)cells.forEach((c,i)=>{c.innerHTML=parts[i]})};
const unread=new Map();   // row → its new content, shown once opened
{const now={};rows.forEach(r=>{const k=rowKey(r),html=contentOf(r);now[k]=html;
    if(seen&&k in seen&&seen[k]!==html&&seen[k].split(SEP).length===cellsOf(r).length){unread.set(r,html);setContent(r,seen[k]);now[k]=seen[k]}});
  seen=now;saveSeen()}
// The bullet tagged @current and every ancestor on its path get the orange current-path line.
document.querySelectorAll('.cur').forEach(c=>{for(let e=c;e;e=e.parentElement){if(e.matches('details.h'))e.classList.add('s-fire');if(e.matches('tr.kids'))e.previousElementSibling.classList.add('s-fire')}if(c.matches('tr.r'))c.classList.add('s-fire')});
const fileCheck=r=>r.dataset.check||(r.dataset.checked==='1'?'done':'open');
const fileDone=r=>fileCheck(r)==='done';
const effective=r=>{const k=rowKey(r);return k in chk?chk[k]:fileDone(r)};
const childRows=r=>{const n=r.nextElementSibling;return n&&n.classList.contains('kids')?[...n.querySelectorAll(':scope > td > table.ol > tbody > tr.r')]:[]};
const descendants=r=>childRows(r).flatMap(k=>[k,...descendants(k)]);
const KIND_ORDER=['open','agent','pending','done'];
const KIND_TITLE={open:'Open',agent:'Claim',pending:'Pending human approval',done:'Approved'};
const ownKind=r=>{const file=fileCheck(r),on=effective(r);
  if(on&&file!=='done')return 'pending';if(file==='done'&&on)return 'done';if(file==='agent')return 'agent';return 'open'};
const isGroup=r=>r.dataset.group==='options';
const parentRow=r=>{const k=r.closest('tr.kids');return k&&k.previousElementSibling};
const kindsOf=r=>{const kids=childRows(r);if(!kids.length)return [ownKind(r)];
  const seen={};kids.forEach(k=>kindsOf(k).forEach(kind=>{seen[kind]=1}));
  if(isGroup(r))return [['done','pending','agent'].find(k=>seen[k])||'open'];
  return KIND_ORDER.filter(k=>seen[k])};
// An approval or choice already sent but not yet recorded in the file, then undone, must be sent as undone too.
const retracted=new Set();
const setWant=(r,want)=>{const key=rowKey(r);delete backTo[key];
  if(key in sent&&sent[key]!==want&&want===fileDone(r))retracted.add(r);else retracted.delete(r);
  if(want===fileDone(r))delete chk[key];else chk[key]=want;delete sent[key]};
const choose=r=>{setWant(r,true);childRows(parentRow(r)).forEach(s=>{if(s!==r)setWant(s,false)})};
// Everything approved, some of it still waiting for the agent to record it, reads as pending; otherwise differing states are mixed.
const aggOf=kinds=>kinds.every(k=>k==='done'||k==='pending')?(kinds.includes('pending')?'pending':'done'):kinds.length>1?'mixed':kinds[0];
const paint=r=>{const box=r.querySelector('input.ck');const on=effective(r),file=fileCheck(r),opt=!!r.dataset.opt;
  const pendingOn=on&&file!=='done';const pendingOff=!on&&file==='done';
  const outvoted=opt&&!on&&childRows(parentRow(r)).some(s=>s!==r&&effective(s));
  box.checked=on||(file==='agent'&&!outvoted&&!(rowKey(r) in chk));
  box.classList.toggle('pending',pendingOn);box.classList.toggle('agent',file==='agent'&&!outvoted&&!pendingOn&&!pendingOff);
  box.title=opt
    ?(pendingOn?'Pending choice — filled once the agent records it':pendingOff?'Pending un-choose — cleared once the agent records it':file==='agent'?'Recommended — click to choose it':on?'Chosen':'Choose this option')
    :(pendingOn?'Pending approval — filled once the agent records it':pendingOff?'Pending reopen — cleared once the agent records it':file==='agent'?'Claim — click to queue your approval':on?'Approved':'Approve this node');
  const kids=childRows(r),kinds=kindsOf(r);
  let extra=r.querySelector('.cks-extra');
  if(!extra){extra=document.createElement('span');extra.className='cks-extra';box.after(extra);    }
  extra.replaceChildren();
  if(kids.length&&!opt){const agg=aggOf(kinds),mixed=agg==='mixed';
    box.classList.remove('rolled');
    box.checked=agg==='agent'||agg==='pending'||agg==='done';
    box.classList.toggle('agent',agg==='agent');box.classList.toggle('pending',agg==='pending');box.classList.toggle('mixed',mixed);
    box.title=mixed?'Mixed: children are '+kinds.map(k=>KIND_TITLE[k].toLowerCase()).join(', ')+' — click to approve all':KIND_TITLE[agg];
    if(mixed)kinds.forEach(kind=>{const s=document.createElement('span');s.className='tagico ck'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');s.title=KIND_TITLE[kind];extra.appendChild(s)});
    r.classList.toggle('s-done',kinds.length===1&&kinds[0]==='done')}
  else{box.classList.remove('rolled','mixed');
    // An option's radio is its own pick, whatever sits below it; the states of its children show as small marks beside it.
    const below=kids.length?kinds.filter(k=>k!==ownKind(r)):[];
    below.forEach(kind=>{const t=document.createElement('span');t.className='tagico ck'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');t.title='Below: '+KIND_TITLE[kind].toLowerCase();extra.appendChild(t)});
    r.classList.toggle('s-done',(on&&file==='done'&&(!kids.length||kinds.every(k=>k==='done')))||(opt&&kindsOf(parentRow(r))[0]==='done'))}};
// Topic headings carry the same rolled-up checkbox as parent rows, over every bullet inside them.
const heads=[...document.querySelectorAll('#outline-table details.h')].map(d=>{
  const sm=d.querySelector(':scope>summary'),box=document.createElement('input');box.type='checkbox';box.className='ck';
  const extra=document.createElement('span');extra.className='cks-extra';
  sm.prepend(box);sm.querySelector('.ask')?sm.querySelector('.ask').before(extra):sm.append(extra);
  const top=()=>[...d.querySelectorAll('tr.r')].filter(r=>!parentRow(r));
  box.onclick=e=>{e.preventDefault();e.stopPropagation();const before=snapAll(),was=[isComplete(d)],want=!(box.dataset.agg==='done'||box.dataset.agg==='pending');
    rows.filter(r=>d.contains(r)&&!r.dataset.opt&&!isGroup(r)).forEach(r=>setWant(r,want));
    lsSet(':chk',chk);lsSet(':sent',sent);paintTree();setTimeout(paintTree,0);renderStatus();collapseCompleted(record(before),[d],was);
    approvalsChanged(box,want)};
  return {d,box,extra,top}});
const paintHeads=()=>heads.forEach(({d,box,extra,top})=>{
  const seen={};top().forEach(r=>kindsOf(r).forEach(k=>{seen[k]=1}));
  // A topic with no nodes under it shows its own status from the file.
  const kinds=KIND_ORDER.filter(k=>seen[k]),agg=kinds.length?aggOf(kinds):d.dataset.check||'open',mixed=agg==='mixed';
  box.dataset.agg=agg;box.checked=agg==='agent'||agg==='pending'||agg==='done';
  box.classList.toggle('agent',agg==='agent');box.classList.toggle('pending',agg==='pending');box.classList.toggle('mixed',mixed);
  box.title=mixed?'Mixed: '+kinds.map(k=>KIND_TITLE[k].toLowerCase()).join(', ')+' — click to approve all':KIND_TITLE[agg];
  extra.replaceChildren();
  if(mixed)kinds.forEach(kind=>{const t=document.createElement('span');t.className='tagico ck'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');t.title=KIND_TITLE[kind];extra.appendChild(t)})});
const paintTree=()=>{rows.forEach(paint);paintHeads()};
const pending=()=>rows.filter(r=>{const k=rowKey(r);return k in chk&&chk[k]!==fileDone(r)&&sent[k]!==chk[k]});
const approvalRows=()=>[...new Set([...pending(),...retracted])];
const approvalText=(p=approvalRows())=>{const f=(v,opt)=>p.filter(r=>effective(r)===v&&(opt===undefined||!!r.dataset.opt===opt)).map(r=>r.dataset.ref).join('; ');
  const a=f(true,false),c=f(true,true),off=p.filter(r=>!effective(r)),refs=l=>l.map(r=>r.dataset.ref).join('; ');
  const o=refs(off.filter(r=>!backTo[rowKey(r)])),b=refs(off.filter(r=>backTo[rowKey(r)]));
  const line=(lead,refs)=>refs&&lead+refs.replace(/\\.$/,'')+'.';
  return [line('Approved in the outline: ',a),line('Chosen in the outline: ',c),line('Reopened in the outline: ',o),line('Back to claim in the outline: ',b)].filter(Boolean).join('\\n')};
const sbar=document.getElementById('status');
const renderStatus=()=>{paintQueue();const p=LINKED?[]:pending();sbar.hidden=!p.length;sbar.innerHTML='';if(!p.length)return;
  p.forEach(r=>{const t=document.createElement('span');const on=effective(r);t.className='tag'+(on?'':' reopen');t.textContent=(on?(r.dataset.opt?'◉ ':'✓ '):'↺ ')+r.dataset.ref;
    const x=document.createElement('button');x.textContent='×';x.title='Drop this change';x.onclick=()=>{delete chk[rowKey(r)];lsSet(':chk',chk);paintTree();renderStatus()};t.appendChild(x);sbar.appendChild(t)});
  const g=document.createElement('span');g.className='grow';sbar.appendChild(g);
  const x=document.createElement('button');x.className='clearall';x.textContent='Clear all';x.title='Drop every queued change';
  x.onclick=()=>{p.forEach(r=>{delete chk[rowKey(r)]});lsSet(':chk',chk);paintTree();renderStatus()};sbar.appendChild(x);
  const c=document.createElement('button');c.className='copyall';c.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10"/></svg> Copy to clipboard';
  c.onclick=()=>{copyApprovals(approvalText());c.textContent='✓ Copied'};
  sbar.appendChild(c)};
// Linked: each change is sent to the session about a second after the last click, so a burst of ticks goes as one message.
let sendTimer;
const approvalsChanged=(el,want)=>{
  if(!LINKED){if(want){const text=approvalText();if(text){try{navigator.clipboard.writeText(text)}catch(e){}toast(el)}}return}
  clearTimeout(sendTimer);sendTimer=setTimeout(()=>sendApprovals(el),1200)};
const sendApprovals=async el=>{const batch=approvalRows(),text=approvalText(batch);if(!text)return;
  try{const r=await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminal:TERMINAL,text})});
    if(!r.ok)throw new Error(await r.text());
    batch.forEach(x=>{sent[rowKey(x)]=effective(x);retracted.delete(x)});lsSet(':sent',sent);renderStatus();working();
    notify('Sent: '+text.split('\\n').join(' · '))}
  catch(err){notify('Not sent: '+(err.message||err),true)}};
// A notice that slides in from the right over the message box, stays two seconds, and slides out.
let noticeTimer;
const notify=(text,error)=>{let n=document.getElementById('notice');
  if(!n){n=document.createElement('div');n.id='notice';n.setAttribute('role','status');document.body.appendChild(n)}
  n.textContent=text;n.title=text;n.classList.toggle('error',!!error);
  n.classList.remove('show');void n.offsetWidth;n.classList.add('show');
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.classList.remove('show'),2000)};
const copyApprovals=text=>{try{navigator.clipboard.writeText(text)}catch(e){};pending().forEach(r=>{sent[rowKey(r)]=effective(r)});lsSet(':sent',sent);setTimeout(renderStatus,600)};
rows.forEach(r=>{
  const k=r.nextElementSibling&&r.nextElementSibling.classList.contains('kids');
  if(k){const s=state[rowKey(r)];if(s!==undefined)r.classList.toggle('closed',!s);r.classList.add('parent');
    const flip=()=>{r.classList.toggle('closed');state[rowKey(r)]=!r.classList.contains('closed');try{localStorage.setItem(KEY,JSON.stringify(state))}catch(err){}};
    r.onclick=e=>{if(e.target.closest('input,button,a,.cks-extra')||String(getSelection()).trim())return;flip()};
    r.querySelector('.kc').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip()}}}
  const box=r.querySelector('input.ck');
  paint(r);
  box.onchange=()=>{const before=snapAll(),chain=chainOf(r),was=chain.map(isComplete),file=fileCheck(r);let want=box.checked||(file==='agent'&&!(rowKey(r) in chk));
    if(isGroup(r)){const kids=childRows(r),k=kindsOf(r)[0],pick=kids.find(c=>c.dataset.rec);
      want=k!=='pending'&&k!=='done'&&!!pick;
      if(want)choose(pick);else if(k==='pending'||k==='done')kids.forEach(c=>setWant(c,false))}
    else if(r.dataset.opt){if(want)choose(r);else setWant(r,false)}
    else [r,...descendants(r)].forEach(node=>setWant(node,want));
    lsSet(':chk',chk);lsSet(':sent',sent);paintTree();renderStatus();collapseCompleted(record(before),chain,was);
    approvalsChanged(box,want)};
  const b=r.querySelector('.ask');
  b.onclick=e=>{e.preventDefault();e.stopPropagation();
    if(LINKED)return refOut('Re: outline "'+DOC_TITLE+'" › '+headPath(r)+r.dataset.ref,b,r.dataset.ref);
    const ap=approvalText();
    try{navigator.clipboard.writeText((ap?ap+'\\n':'')+'Re: outline "'+DOC_TITLE+'" › '+headPath(r)+r.dataset.ref+' — ')}catch(err){}
    pending().forEach(x=>{sent[rowKey(x)]=effective(x)});lsSet(':sent',sent);renderStatus();
    toast(b);}});
// Undo: each click that changes approvals (a node's or a topic's checkbox, an option pick) is one step, holding every
// node it changed as it was before: its override and its status in the file. Undoing puts each node back, through the
// same path as a click, so what was already sent is sent back (Reopened, Chosen, or Back to claim for a former claim).
// The steps are kept per outline for this tab, so the reloads the agent's edits cause do not lose them.
const UNDO=KEY+':undo';
let undoSteps=[];try{undoSteps=JSON.parse(sessionStorage.getItem(UNDO)||'[]')}catch(e){}
const undoBtn=document.getElementById('undo');
const paintUndo=()=>{if(!undoBtn)return;undoBtn.disabled=!undoSteps.length;
  undoBtn.title=undoSteps.length?'Undo your last approval ('+undoSteps.length+' step'+(undoSteps.length===1?'':'s')+', ⌘Z)':'Nothing to undo'};
const saveUndo=()=>{undoSteps=undoSteps.slice(-50);try{sessionStorage.setItem(UNDO,JSON.stringify(undoSteps))}catch(e){};paintUndo()};
const snapAll=()=>rows.map(r=>{const k=rowKey(r);return {k,has:k in chk,v:!!chk[k],file:fileCheck(r)}});
const record=before=>{const nodes=before.filter(s=>(s.k in chk)!==s.has||(s.has&&chk[s.k]!==s.v));if(!nodes.length)return null;
  const step={nodes,collapsed:[]};undoSteps.push(step);saveUndo();return step};
function undoLast(){const step=undoSteps.pop();saveUndo();if(!step)return;
  (step.collapsed||[]).forEach(expandAgain);
  (Array.isArray(step)?step:step.nodes).forEach(s=>{const r=rows.find(x=>rowKey(x)===s.k);if(!r)return;
    const want=s.has?s.v:s.file==='done';setWant(r,want);
    // A former claim that has to be sent back goes as "Back to claim"; one never sent just drops its override.
    if(!want&&s.file==='agent')backTo[s.k]=1});
  lsSet(':chk',chk);lsSet(':sent',sent);lsSet(':backto',backTo);paintTree();renderStatus();
  if(LINKED)approvalsChanged(undoBtn,false);notify('Undone')}
if(undoBtn)undoBtn.onclick=undoLast;
addEventListener('keydown',e=>{if(!(e.metaKey||e.ctrlKey)||e.shiftKey||e.altKey||e.key.toLowerCase()!=='z')return;
  if(e.target.closest&&e.target.closest('input:not([type=checkbox]),textarea,[contenteditable],.xterm'))return;
  if(!rows.length)return;e.preventDefault();undoLast()});
// Completing a parent collapses it: when a click leaves every descendant approved (recorded or pending), or picks an
// option, that node closes over half a second while the page scrolls it to the top, just below the sticky headers of
// its ancestors. If the click completes several levels at once, the outermost one animates and the inner ones close
// with it. The click's undo step lists what closed, so undoing opens it again.
const chainOf=r=>{const c=[];for(let x=r;x;x=parentRow(x))if(childRows(x).length)c.push(x);const d=r.closest('details.h');if(d)c.push(d);return c};
const allApproved=kinds=>kinds.length>0&&kinds.every(k=>k==='pending'||k==='done');
const isComplete=n=>{if(n.tagName!=='DETAILS')return allApproved(kindsOf(n));
  const top=[...n.querySelectorAll('tr.r')].filter(r=>!parentRow(r));return top.length>0&&top.every(r=>allApproved(kindsOf(r)))};
const isOpen=n=>n.tagName==='DETAILS'?n.open:!n.classList.contains('closed');
const nodeId=n=>n.tagName==='DETAILS'?{topic:path(n)}:{row:rowKey(n)};
const closeNode=n=>{if(n.tagName==='DETAILS'){n.open=false;return}
  n.classList.add('closed');state[rowKey(n)]=false;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}};
function expandAgain(id){if(id.topic){const d=[...document.querySelectorAll('details.h')].find(x=>path(x)===id.topic);if(d)d.open=true;return}
  const r=rows.find(x=>rowKey(x)===id.row);if(!r)return;r.classList.remove('closed');state[id.row]=true;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function collapseCompleted(step,chain,was){const done=chain.filter((n,i)=>!was[i]&&isComplete(n)&&isOpen(n));if(!done.length)return;
  if(step)step.collapsed=done.map(nodeId);saveUndo();
  const outer=done[done.length-1];done.slice(0,-1).forEach(closeNode);
  // The node's own place in the page: a stuck header reports where it sticks, so measure its box (row group or topic).
  const head=outer.tagName==='DETAILS'?outer.querySelector(':scope>summary'):outer,box=outer.tagName==='DETAILS'?outer:outer.parentElement;
  const body=outer.tagName==='DETAILS'?outer.querySelector(':scope>.body'):outer.nextElementSibling;
  const from=scrollY,h0=body.offsetHeight,want=Math.max(0,box.getBoundingClientRect().top+from-stackAbove(head)-4);
  // An item near the end can't reach the top once its children are gone, so a spacer under the outline makes room.
  const room=want-(document.documentElement.scrollHeight-h0-innerHeight);
  if(room>0){let sp=document.getElementById('scroll-room');if(!sp){sp=document.createElement('div');sp.id='scroll-room';document.body.appendChild(sp)}
    sp.style.height=(sp.offsetHeight+room)+'px'}
  body.style.overflow='hidden';body.style.height=h0+'px';const start=performance.now();
  const step2=now=>{const t=Math.min(1,(now-start)/500),e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    body.style.height=(h0*(1-e))+'px';scrollTo(0,from+(want-from)*e);
    if(t<1)return requestAnimationFrame(step2);
    closeNode(outer);body.style.height='';body.style.overflow='';scrollTo(0,want);queueStuck()};
  requestAnimationFrame(step2)}
// An override the file has caught up with (the agent recorded it) is dropped, so the file's own status shows again.
rows.forEach(r=>{const k=rowKey(r);if(k in chk&&chk[k]===fileDone(r)){delete chk[k];delete sent[k];delete backTo[k]}});
lsSet(':chk',chk);lsSet(':sent',sent);lsSet(':backto',backTo);paintTree();paintUndo();
// Queue: an item leaves the left pane as soon as its bullet is approved or chosen here (the agent drops it from the
// file later); clicking one shows its node in the Outline tab.
// Scrolls el to the top, just below the top bar and the sticky headers of its ancestors (topic headings, parent rows),
// animated over 200 ms (ease-out) rather than jumping; then calls done.
function stackAbove(el){let h=document.querySelector('.bar').offsetHeight;
  for(let e=el.tagName==='SUMMARY'?el.parentElement.parentElement:el.parentElement;e;e=e.parentElement){
    if(e.tagName==='DETAILS'&&e.classList.contains('h'))h+=e.querySelector(':scope>summary').offsetHeight;
    else if(e.matches&&e.matches('tr.kids'))h+=e.previousElementSibling.offsetHeight}
  return h}
function scrollToNode(el,done){const from=scrollY,r=el.getBoundingClientRect(),want=Math.max(0,from+r.top-stackAbove(el)-4);
  // An item near the end can't reach the top on its own, so a spacer under the outline grows to make room.
  const room=want-(document.documentElement.scrollHeight-innerHeight);
  if(room>0){let sp=document.getElementById('scroll-room');if(!sp){sp=document.createElement('div');sp.id='scroll-room';document.body.appendChild(sp)}
    sp.style.height=(sp.offsetHeight+room)+'px'}
  const to=Math.min(want,document.documentElement.scrollHeight-innerHeight),start=performance.now();
  const step=now=>{const t=Math.min(1,(now-start)/200);scrollTo(0,from+(to-from)*(1-Math.pow(1-t,3)));if(t<1)requestAnimationFrame(step);else if(done)done()};
  requestAnimationFrame(step)}
function queueNode(num){return document.querySelector('#outline-table tr.r[data-num="'+num+'"]')
  ||[...document.querySelectorAll('#outline-table details.h')].find(d=>(d.dataset.key||'').startsWith(num+'. '))}
function paintQueue(){document.querySelectorAll('.queue .q:not(.q-unread)').forEach(q=>{const node=queueNode(q.dataset.num);q.classList.toggle('missing',!node);
  if(q.classList.contains('q-action')&&node&&node.matches('tr.r')){q.parentElement.hidden=!node.dataset.action||!!runs[rowKey(node)];return}
  const kinds=!node?[]:node.matches('tr.r')?kindsOf(node):[...node.querySelectorAll('tr.r')].filter(r=>!parentRow(r)).flatMap(kindsOf);
  q.parentElement.hidden=kinds.length>0&&kinds.every(k=>k==='pending'||k==='done')})}
document.querySelectorAll('.queue .q').forEach(q=>q.onclick=()=>{const node=queueNode(q.dataset.num);if(!node)return toast(q,'Not in the outline');
  if(tab!=='outline')setTab('outline');
  for(let e=node.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.matches&&e.matches('tr.kids'))e.previousElementSibling.classList.remove('closed')}
  if(node.tagName==='DETAILS')node.open=true;
  const target=node.tagName==='DETAILS'?node.querySelector(':scope>summary'):node;
  document.querySelectorAll('.qmark').forEach(m=>m.classList.remove('qmark'));
  target.style.setProperty('--qline',{decide:'#d1242f',action:'#d1242f',approve:'var(--accent)',read:'var(--fg)'}[q.className.match(/q-(\\w+)/)[1]]);
  setTimeout(()=>scrollToNode(target,()=>{void target.offsetWidth;target.classList.add('qmark');
    clearTimeout(target._qmark);target._qmark=setTimeout(()=>target.classList.remove('qmark'),1700)}),0)});
// Actions: play sends "Run in the outline: …" (copied when no session is linked). The button waits, dimmed, until the
// agent marks the bullet @ran, which removes it; a run already sent survives a reload.
const runs=lsGet(':runs');
Object.keys(runs).forEach(k=>{if(!rows.some(r=>rowKey(r)===k&&r.dataset.action))delete runs[k]});lsSet(':runs',runs);
document.querySelectorAll('tr.r[data-action] .play').forEach(b=>{const r=b.closest('tr.r');
  const mark=()=>{b.classList.add('sent');b.title='Sent: waiting for the agent to run it'};
  if(runs[rowKey(r)])mark();
  b.onclick=async e=>{e.preventDefault();e.stopPropagation();if(b.classList.contains('sent'))return;
    const text='Run in the outline: '+r.dataset.ref.replace(/\\.$/,'')+'.';
    if(!LINKED){try{navigator.clipboard.writeText(text)}catch(err){}toast(b);return}
    try{const res=await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminal:TERMINAL,text})});
      if(!res.ok)throw new Error(await res.text());
      runs[rowKey(r)]=1;lsSet(':runs',runs);mark();paintQueue();working();notify('Sent: '+text)}
    catch(err){notify('Not sent: '+(err.message||err),true)}}});
// Changed text is marked with a diff icon (plus over minus), in the agent's blue.
const DIFF_ICON='<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 2.5v6M5 5.5h6M5 12.5h6"/></svg>';
// Opening shows what changed as a cursor passing through the text from its start. It scans over unchanged words
// quickly; added words grow in one by one in green, pushing the rest along, and fade to nothing; removed words, in red,
// collapse one by one; rewritten words collapse while the new ones grow in beside them (white, fading out).
const words=t=>t.split(/(\\s+)/).filter(Boolean);
// The text as blocks in order: unchanged ('eq'), 'add', 'del' and 'chg' (words replaced by others), each with its
// character range in the old text (a) and in the new text (b).
function diffWords(a,b){const n=a.length,m=b.length;if(n*m>250000)return null;
  const L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=a[i]===b[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const ops=[];for(let i=0,j=0;i<n||j<m;){if(i<n&&j<m&&a[i]===b[j])ops.push(['=',a[i++].length,b[j++].length]);
    else if(j<m&&(i>=n||L[i][j+1]>=L[i+1][j]))ops.push(['+',0,b[j++].length]);else ops.push(['-',a[i++].length,0])}
  const blocks=[];let ao=0,bo=0;
  for(let k=0;k<ops.length;){const as=ao,bs=bo,eq=ops[k][0]==='=';
    while(k<ops.length&&(ops[k][0]==='=')===eq){ao+=ops[k][1];bo+=ops[k][2];k++}
    blocks.push({k:eq?'eq':ao>as&&bo>bs?'chg':ao>as?'del':'add',a:[as,ao],b:[bs,bo]})}
  return blocks}
// Wraps character ranges of root's text (ascending, not overlapping) in spans, one per text node they touch (last
// first, so earlier offsets hold); returns each range's spans in document order.
function wrapGroups(root,ranges){const nodes=[],walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let off=0,n;(n=walk.nextNode());){nodes.push([n,off,off+n.data.length]);off+=n.data.length}
  const pieces=[];
  ranges.forEach(([s,e],gi)=>nodes.forEach(([n,s0,e0])=>{const ls=Math.max(s,s0),le=Math.min(e,e0);if(le>ls)pieces.push([gi,n,ls-s0,le-s0])}));
  const groups=ranges.map(()=>[]);
  pieces.reverse().forEach(([gi,n,ls,le])=>{const rg=document.createRange(),sp=document.createElement('span');
    rg.setStart(n,ls);rg.setEnd(n,le);rg.surroundContents(sp);groups[gi].unshift(sp)});
  return groups}
// Splits a span's text into units (a word with the space after it), each of which can grow in or collapse on its own.
function unitize(sp,text=sp.textContent){const pre=!!sp.closest('pre');sp.textContent='';
  return (text.match(/\\S+\\s*|\\s+/g)||[]).map(t=>{const u=document.createElement('span');u.className='tx-u';
    u.textContent=pre?t:t.replace(/\\s+/g,' ');sp.appendChild(u);return u})}
// Puts a cell's new content in place so that it reads as the old one: removed words come back as red ghosts at their
// place, added words are hidden. Returns the steps in text order.
function stageCell(c,diff,oldText){
  const groups=wrapGroups(c,diff.filter(b=>b.b[1]>b.b[0]).map(b=>b.b));let gi=0;const steps=[];
  diff.forEach(b=>{const spans=b.b[1]>b.b[0]?groups[gi++]:[];
    if(b.k==='eq'){const stops=[];
      spans.forEach(sp=>{sp.className='tx-q';const n=sp.firstChild,re=/\\S+/g;let m;
        while(n&&n.nodeType===3&&(m=re.exec(n.data)))stops.push([n,m.index+m[0].length])});
      steps.push({k:'eq',stops,spans});return}
    const add=spans.flatMap(sp=>{sp.className='tx-n'+(b.k==='chg'?' c':'');return unitize(sp)});
    let old=[];
    if(b.a[1]>b.a[0]){const g=document.createElement('span');g.className='tx-o';
      if(add.length)spans[0].before(g);
      else{const prev=steps[steps.length-1],last=prev&&prev.spans&&prev.spans[prev.spans.length-1];
        if(last)last.after(g);else c.prepend(g)}
      old=unitize(g,oldText.slice(b.a[0],b.a[1]))}
    steps.push({k:b.k,add,old})});
  // A block whose words are all still hidden (a new paragraph or list item) is hidden too, until its first word comes in.
  c.querySelectorAll('p,li,pre,blockquote,ul,ol,h1,h2,h3,h4,h5,h6,table,tr').forEach(e=>{
    if(!e.textContent.trim())return;
    const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let shown=false;
    for(let n;(n=w.nextNode());)if(n.data.trim()&&!n.parentElement.closest('.tx-n')){shown=true;break}
    if(!shown)e.classList.add('tx-hide')});
  return steps}
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const frames=(ms,fn)=>new Promise(res=>{const t0=performance.now();
  const f=now=>{const p=Math.min(1,(now-t0)/ms);fn(p);if(p<1)requestAnimationFrame(f);else res()};requestAnimationFrame(f)});
async function openUnread(r){const next=unread.get(r);if(next===undefined)return;unread.delete(r);
  r.querySelector('.env')?.remove();document.querySelector('.queue .q-unread[data-key="'+CSS.escape(rowKey(r))+'"]')?.parentElement.remove();
  const parts=next.split(SEP),cells=cellsOf(r);seen[rowKey(r)]=next;saveSeen();
  if(parts.length!==cells.length)return;
  const olds=cells.map(c=>c.textContent),
    diffs=cells.map((c,i)=>{const t=document.createElement('div');t.innerHTML=parts[i];return diffWords(words(olds[i]),words(t.textContent))});
  const changed=d=>d&&d.some(b=>b.k!=='eq');
  // Nobody is watching a hidden page (and it would not draw frames), or wants motion: the text just changes.
  if(!diffs.some(changed)||document.visibilityState!=='visible'||matchMedia('(prefers-reduced-motion: reduce)').matches)return setContent(r,next);
  const cur=document.createElement('div');cur.className='tx-cur';cur.style.opacity=0;document.body.appendChild(cur);
  let placed=false;
  const put=rc=>{if(!rc||(!rc.height&&!rc.width))return;
    if(!placed)cur.style.transition='none';
    cur.style.height=rc.height+'px';cur.style.transform='translate('+rc.left+'px,'+rc.top+'px)';
    if(!placed){placed=true;cur.style.opacity=1;void cur.offsetWidth;cur.style.transition=''}};
  const edge=(el,end)=>{const rc=el.getBoundingClientRect();return {left:end?rc.right:rc.left,top:rc.top,height:rc.height,width:0}};
  const at=(n,o)=>{const rg=document.createRange();rg.setStart(n,o);rg.collapse(true);return rg.getClientRects()[0]||rg.getBoundingClientRect()};
  try{
    const stages=cells.map((c,i)=>{c.innerHTML=parts[i];return changed(diffs[i])?stageCell(c,diffs[i],olds[i]):null});
    // The more there is to show, the faster the cursor goes.
    const load=stages.reduce((n,st)=>n+(st?st.reduce((m,s)=>m+(s.k==='eq'?s.stops.length/6:s.add.length+s.old.length),0):0),0);
    const speed=Math.min(4,Math.max(1,load/50));
    const grow=(u,cell)=>{for(let e=u.parentElement;e;e=e.parentElement){e.classList.remove('tx-hide');if(e===cell)break}
      u.classList.add('on');const w=u.getBoundingClientRect().width;
      u.animate([{maxWidth:'0px',opacity:0},{maxWidth:w+'px',opacity:1}],{duration:130/speed,easing:'ease-out'})};
    const shrink=u=>{const w=u.getBoundingClientRect().width;
      u.animate([{maxWidth:w+'px',opacity:1},{maxWidth:'0px',opacity:0}],{duration:110/speed,easing:'ease-in',fill:'forwards'})};
    for(let i=0;i<cells.length;i++){const st=stages[i];if(!st)continue;
      for(const s of st){
        if(s.k==='eq'){const n=s.stops.length;if(!n)continue;
          await frames(Math.min(500,Math.max(60,n*9))/speed,p=>{const [node,off]=s.stops[Math.min(n-1,Math.floor(p*n))];put(at(node,off))});
          continue}
        if(s.old.length){put(edge(s.old[0],false));await sleep(90/speed)}
        const n=Math.max(s.old.length,s.add.length);
        for(let j=0;j<n;j++){const o=s.old[j],a=s.add[j];
          if(o)shrink(o);if(a)grow(a,cells[i]);
          const dur=(s.k==='add'?36:s.k==='del'?28:42)/speed;
          await frames(dur,()=>put(a?edge(a,true):edge(o,false)))}
        await sleep(40/speed)}}
    // The last words are still fading; the cursor leaves once they have.
    await sleep(800/Math.min(speed,2));cur.style.opacity=0;await sleep(160)
  }finally{cells.forEach((c,i)=>{c.innerHTML=parts[i]});cur.remove();queueStuck()}}
if(unread.size){let list=document.querySelector('.rail .queue');
  if(!list){document.querySelector('.rail').insertAdjacentHTML('beforeend','<hr class="rail-sep"><ol class="queue" aria-label="Your queue"></ol>');list=document.querySelector('.rail .queue')}
  // Unread items come first in the left pane, in outline order.
  [...unread.keys()].reverse().forEach(r=>{const li=document.createElement('li'),q=document.createElement('button');
    q.type='button';q.className='q q-unread';q.dataset.key=rowKey(r);q.title='Changed since you read it: '+r.dataset.ref+' (shows the node; click its diff button to see the change)';q.innerHTML=DIFF_ICON+'<span></span>';q.lastChild.textContent=r.dataset.num;
    q.onclick=()=>{if(tab!=='outline')setTab('outline');
      for(let e=r.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.matches&&e.matches('tr.kids'))e.previousElementSibling.classList.remove('closed')}
      // Only shows the bullet: the change opens when you click its diff button, which pulses to point it out.
      setTimeout(()=>scrollToNode(r,()=>{r.style.setProperty('--qline','var(--accent)');r.classList.remove('qmark');void r.offsetWidth;r.classList.add('qmark');
        clearTimeout(r._qmark);r._qmark=setTimeout(()=>r.classList.remove('qmark'),1700);
        const env=r.querySelector('.env');if(env){env.classList.remove('pulse');void env.offsetWidth;env.classList.add('pulse')}}),0)};
    li.appendChild(q);list.prepend(li)});
  unread.forEach((_,r)=>{const b=document.createElement('button');b.type='button';b.className='env';b.title='Changed since you read it: click to see what changed';b.innerHTML=DIFF_ICON;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();openUnread(r)};r.querySelector('.s').prepend(b)})}
// Inbox: the agent's @message notes, from /messages. The left pane's red envelope lists the last ten; a bullet's own
// envelope lists those naming it or any bullet under it. Opening a list marks its messages seen.
const MAIL_ICON=${JSON.stringify(MAIL_ICON)},MSEEN=KEY+':msgseen',inboxBtn=document.getElementById('inbox-open'),inboxBox=document.getElementById('inbox');
let msgs=[],mseen=new Set();try{mseen=new Set(JSON.parse(localStorage.getItem(MSEEN)||'[]'))}catch(e){}
const under=(num,m)=>m.num===num||m.num.startsWith(num+'.');
function revealNum(num){const node=queueNode(num);if(!node)return;if(tab!=='outline')setTab('outline');
  for(let e=node.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.matches&&e.matches('tr.kids'))e.previousElementSibling.classList.remove('closed')}
  if(node.tagName==='DETAILS')node.open=true;setTimeout(()=>scrollToNode(node.tagName==='DETAILS'?node.querySelector(':scope>summary'):node),0)}
function showInbox(list,anchor,heading){inboxBox.replaceChildren();const h=document.createElement('h4');h.textContent=heading;inboxBox.append(h);
  if(!list.length){const p=document.createElement('div');p.className='empty';p.textContent='No messages yet.';inboxBox.append(p)}
  [...list].reverse().forEach(m=>{const el=document.createElement('div');el.className='msg'+(mseen.has(m.id)?'':' unseen');
    const meta=document.createElement('div');meta.className='meta';
    if(m.num){const a=document.createElement('a');a.textContent=m.num;a.title='Show this node';a.onclick=()=>{inboxBox.hidden=true;revealNum(m.num)};meta.append(a)}
    const t=document.createElement('span');t.textContent=new Date(m.at).toLocaleString([], {hour:'2-digit',minute:'2-digit',month:'short',day:'numeric'});meta.append(t);
    const body=document.createElement('div');body.innerHTML=m.html;el.append(meta,body);inboxBox.append(el)});
  inboxBox.hidden=false;const r=anchor.getBoundingClientRect(),w=inboxBox.offsetWidth,hh=inboxBox.offsetHeight;
  if(anchor===inboxBtn){inboxBox.style.left=(r.right+8)+'px';inboxBox.style.top=Math.max(8,r.bottom-hh)+'px'}
  else{inboxBox.style.left=Math.max(84,Math.min(r.right-w,innerWidth-w-12))+'px';inboxBox.style.top=(r.bottom+6+hh>innerHeight?Math.max(8,r.top-6-hh):r.bottom+6)+'px'}
  list.forEach(m=>mseen.add(m.id));try{localStorage.setItem(MSEEN,JSON.stringify([...mseen].slice(-500)))}catch(e){}
  paintInbox()}
function paintInbox(){if(!inboxBtn)return;
  const unseen=msgs.filter(m=>!mseen.has(m.id)).length;inboxBtn.hidden=!msgs.length;inboxBtn.querySelector('.n').textContent=unseen||'';
  inboxBtn.title=msgs.length+' message'+(msgs.length===1?'':'s')+' from the agent'+(unseen?', '+unseen+' unseen':'');
  document.querySelectorAll('.msgs').forEach(b=>b.remove());
  const nodes=[...rows.map(r=>[r,r.dataset.num,r.querySelector('.nh')]),...[...document.querySelectorAll('#outline-table details.h')].map(d=>[d,(d.dataset.key||'').split(/[.\\s]/)[0],d.querySelector(':scope>summary')])];
  nodes.forEach(([node,num,host])=>{if(!num||!host)return;const mine=msgs.filter(m=>m.num&&under(num,m));if(!mine.length)return;
    const fresh=mine.filter(m=>!mseen.has(m.id)).length,b=document.createElement('button');b.type='button';b.className='msgs'+(fresh?'':' seen');
    b.title=mine.length+' message'+(mine.length===1?'':'s')+' about '+num+(fresh?', '+fresh+' unseen':'');b.innerHTML=MAIL_ICON+'<span class="n"></span>';b.lastChild.textContent=fresh||'';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();showInbox(mine,b,'Messages about '+num)};
    const icons=host.tagName==='SUMMARY'&&host.querySelector(':scope>.cks-extra');if(icons)icons.before(b);else host.append(b)})}
if(inboxBtn){inboxBtn.onclick=e=>{e.stopPropagation();if(!inboxBox.hidden)return inboxBox.hidden=true;showInbox(msgs.slice(-10),inboxBtn,'Messages from the agent')};
  addEventListener('click',e=>{if(!inboxBox.hidden&&!inboxBox.contains(e.target))inboxBox.hidden=true});
  addEventListener('keydown',e=>{if(e.key==='Escape')inboxBox.hidden=true});
  const mes=new EventSource('/messages?id='+encodeURIComponent(SESSION));
  mes.onmessage=e=>{msgs.push(...JSON.parse(e.data));paintInbox()};mes.addEventListener('reset',()=>{msgs=[];paintInbox()})}
paintHeads();renderStatus();
if(LINKED)document.querySelectorAll('.ask').forEach(b=>{b.innerHTML=INSERT_ICON;b.title='Add a reference to this item to the message box'});
// The bar stays one row: whatever doesn't fit moves, rightmost first, into the ⋯ menu.
const bar=document.querySelector('.bar');
const more=Object.assign(document.createElement('button'),{type:'button',className:'more icon',title:'More',textContent:'⋯'});more.setAttribute('aria-haspopup','menu');
const menu=Object.assign(document.createElement('div'),{className:'menu',hidden:true});menu.setAttribute('role','menu');
const flow=[...bar.children].filter(el=>el.id!=='tabs'&&!el.classList.contains('waiting'));
bar.append(more,menu);
// If the tabs alone still don't fit, the unselected ones drop their labels.
const fitBar=()=>{flow.forEach(el=>more.before(el));more.hidden=false;bar.classList.remove('compact');
  const over=()=>bar.scrollWidth>bar.clientWidth+1;
  for(let i=flow.length-1;i>=0&&over();i--)menu.prepend(flow[i]);
  more.hidden=!menu.children.length;if(more.hidden)menu.hidden=true;
  if(over())bar.classList.add('compact')};
more.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden};
addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==more)menu.hidden=true});
new ResizeObserver(fitBar).observe(bar);
// Tabs: outline, md, term (the outline names a tmux session) and transcript (it names a session id). ':md' is the older key for the markdown tab.
// term and transcript are live, so while one is open an outline change only marks the page stale; leaving the tab reloads it.
let tab='outline',stale=false;
const LIVE_TABS=['term','transcript'];
const setTab=t=>{try{localStorage.setItem(KEY+':tab',t);localStorage.removeItem(KEY+':md')}catch(e){}
  if(LIVE_TABS.includes(tab)&&!LIVE_TABS.includes(t)&&stale)return location.reload();
  tab=t;['md','term','transcript'].forEach(x=>document.body.classList.toggle('show-'+x,t===x));
  tabs.querySelectorAll('[data-m]').forEach(x=>{x.classList.toggle('on',x.dataset.m===t);x.setAttribute('aria-selected',String(x.dataset.m===t))});
  fitBar();
  if(t==='term'&&TERM_ON)openTerm();else if(t==='transcript'&&SESSION)openTranscript();else queueStuck()};
const TERM_ON=!!document.querySelector('#term:not(.off)');
if(window.tabs){tabs.onclick=e=>{const s=e.target.closest('[data-m]');if(s)setTab(s.dataset.m)};
  try{const t=localStorage.getItem(KEY+':tab')||(localStorage.getItem(KEY+':md')?'md':'');if(t&&tabs.querySelector('[data-m="'+t+'"]'))setTimeout(()=>setTab(t),0)}catch(e){}}
// Model and effort pickers. The outline's Model line catches up only when the agent rewrites it, so the page remembers
// what was sent, for as long as the line still reads what it did then.
const picker=document.querySelector('.picker');
if(picker){const LINE=picker.dataset.line,PK=KEY+':pick';let sent={};
  try{sent=JSON.parse(localStorage.getItem(PK)||'{}')}catch(e){}
  if(sent.line===LINE)Object.entries(sent.values||{}).forEach(([id,v])=>{const s=document.getElementById(id);if(s&&[...s.options].some(o=>o.value===v))s.value=v});
  else try{localStorage.removeItem(PK)}catch(e){}
  picker.querySelectorAll('select').forEach(s=>s.dataset.prev=s.value);
  picker.onchange=async e=>{const s=e.target;if(!s.value)return;s.disabled=true;
    try{const r=await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminal:TERMINAL,text:(s.id==='pick-model'?'/model ':'/effort ')+s.value})});
      if(!r.ok)throw new Error(await r.text());
      sent={line:LINE,values:{...(sent.line===LINE?sent.values:{}),[s.id]:s.value}};s.dataset.prev=s.value;try{localStorage.setItem(PK,JSON.stringify(sent))}catch(e){}}
    catch(err){s.value=s.dataset.prev;toast(s,'Not sent: '+(err.message||err))}
    s.disabled=false}}
// A session just started from the page: show its terminal, and move to its outline (on the Terminal tab) once the agent writes it.
const WAIT_FOR=${JSON.stringify(waitFor || '')};
if(WAIT_FOR){setTimeout(()=>setTab('term'),0);
  const poll=async()=>{try{const j=await (await fetch('/api/outline-for?terminal='+encodeURIComponent(WAIT_FOR))).json();
      if(j.href){try{localStorage.setItem(j.key+':tab','term')}catch(e){}location.href=j.href;return}}catch(e){}
    setTimeout(poll,2000)};
  poll()}
// Transcript tab: the session's messages streamed from /transcript; tool results fill in their tool call by id.
let transcriptOpen=false;
const openTranscript=()=>{const msg=document.getElementById('msg');if(msg)msg.focus();if(transcriptOpen)return;transcriptOpen=true;
  const log=document.getElementById('tlog');
  const atBottom=()=>innerHeight+scrollY>=document.documentElement.scrollHeight-80;
  const tes=new EventSource('/transcript?id='+encodeURIComponent(SESSION));
  let first=true,customTitle=false;
  tes.onmessage=e=>{const stick=first||atBottom();if(first){log.replaceChildren();first=false}
    for(const it of JSON.parse(e.data)){
      if(it.title){if(it.custom||!customTitle){ttitle.textContent=it.title;customTitle=customTitle||it.custom}}
      else if(it.result){const d=log.querySelector('details.tool[data-id="'+CSS.escape(it.result)+'"]');if(d)d.insertAdjacentHTML('beforeend',it.html)}
      else log.insertAdjacentHTML('beforeend',it.html)}
    if(stick)scrollTo(0,document.documentElement.scrollHeight)};
  tes.addEventListener('missing',()=>{log.innerHTML='<p class="note">No transcript found for session '+SESSION+'.</p>';tes.close()});
  tes.addEventListener('reset',()=>{first=true;customTitle=false;ttitle.textContent='Untitled'})};
// The message box: one element shared by the Outline, Markdown and Transcript tabs, so its draft is the same in all three.
// It types into the session's tmux pane. Its height is kept in --composer-h so content and the status bar clear it.
const msg=document.getElementById('msg');
let addChip=()=>{};
// The spinner left of the message box: on while the agent is in a turn (from /activity, which follows the transcript),
// and on at once when the page sends something. Without a linked session id there is no way to see the turn end, so no spinner.
const working=()=>{if(SESSION)document.getElementById('spin')?.classList.add('on')};
if(SESSION&&document.getElementById('spin')){const spin=document.getElementById('spin');
  new EventSource('/activity?id='+encodeURIComponent(SESSION)).addEventListener('state',e=>spin.classList.toggle('on',e.data==='busy'))}
if(msg){const DRAFT=KEY+':draft',CHIPS=KEY+':chips',send=composer.querySelector('.send'),chipBox=document.getElementById('chips');
  let chips=[];try{chips=JSON.parse(sessionStorage.getItem(CHIPS)||'[]')}catch(e){}
  const saveChips=()=>{try{sessionStorage.setItem(CHIPS,JSON.stringify(chips))}catch(e){}};
  const drawChips=()=>{chipBox.replaceChildren(...chips.map((c,i)=>{const el=document.createElement('span');el.className='chip';el.title=c.ref;
      const t=document.createElement('span');t.textContent=c.label;const x=document.createElement('button');x.type='button';x.textContent='×';x.title='Remove';
      x.onclick=()=>{chips.splice(i,1);saveChips();drawChips();msg.oninput();msg.focus()};el.append(t,x);
      // The chip's label starts with its node's number: clicking the chip (not its x) shows that node, at the top.
      const num=(/^(\\d+(?:\\.\\d+)*)\\.?\\s/.exec(c.label)||[])[1];
      if(num){el.classList.add('go');el.onclick=e=>{if(e.target.closest('button'))return;if(!queueNode(num))return notify('Not in the outline',true);revealNum(num)}}
      return el}))};
  addChip=(label,ref)=>{if(!chips.some(c=>c.ref===ref))chips.push({label:label||ref,ref});saveChips();drawChips();msg.oninput();msg.focus()};
  drawChips();
  // Slash commands: "/" at the start of the box lists the session's skills and commands (from /api/commands, once per
  // page), filtered as you type. Arrows move, Tab or Enter completes, Esc closes.
  const cmdBox=document.getElementById('cmds');let cmds=null,cmdShown=[],cmdSel=0;
  async function updateCmds(){const m=msg.value.slice(0,msg.selectionStart).match(/^\\/(\\S*)$/);
    if(!m||document.activeElement!==msg){cmdBox.hidden=true;return}
    if(!cmds){cmds=[];try{cmds=await (await fetch('/api/commands?session='+encodeURIComponent(SESSION))).json()}catch(e){}}
    const q=m[1].toLowerCase(),name=c=>c.name.toLowerCase();
    cmdShown=[...cmds.filter(c=>name(c).startsWith(q)),...cmds.filter(c=>!name(c).startsWith(q)&&name(c).includes(q))];
    cmdSel=0;drawCmds()}
  function drawCmds(){cmdBox.hidden=!cmdShown.length;
    cmdBox.replaceChildren(...cmdShown.map((c,i)=>{const el=document.createElement('div');el.className='cmd'+(i===cmdSel?' on':'');el.setAttribute('role','option');
      el.innerHTML='<b></b> <span class="hint"></span><div class="desc"></div>';el.querySelector('b').textContent='/'+c.name;
      el.querySelector('.hint').textContent=c.hint||'';el.querySelector('.desc').textContent=c.description||'';el.title=c.source;
      el.onmousedown=e=>{e.preventDefault();cmdSel=i;pickCmd()};return el}));
    const on=cmdBox.querySelector('.on');if(on)on.scrollIntoView({block:'nearest'})}
  function pickCmd(){const c=cmdShown[cmdSel];if(!c)return;const rest=msg.value.slice(msg.selectionStart).replace(/^\\S*\\s*/,'');
    msg.value='/'+c.name+' '+rest;const at=c.name.length+2;msg.setSelectionRange(at,at);cmdBox.hidden=true;msg.oninput()}
  function cmdKey(e){if(cmdBox.hidden)return false;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){cmdSel=(cmdSel+(e.key==='ArrowDown'?1:cmdShown.length-1))%cmdShown.length;drawCmds()}
    else if(e.key==='Tab'||(e.key==='Enter'&&!e.shiftKey&&!e.isComposing))pickCmd();
    else if(e.key==='Escape')cmdBox.hidden=true;
    else return false;
    e.preventDefault();return true}
  msg.addEventListener('blur',()=>{cmdBox.hidden=true});
  msg.addEventListener('click',()=>updateCmds());
  new ResizeObserver(()=>document.documentElement.style.setProperty('--composer-h',composer.offsetHeight+'px')).observe(composer);
  try{msg.value=sessionStorage.getItem(DRAFT)||''}catch(e){}
  msg.oninput=()=>{msg.style.height='auto';msg.style.height=msg.scrollHeight+2+'px';send.disabled=!msg.value.trim()&&!chips.length;try{sessionStorage.setItem(DRAFT,msg.value)}catch(e){}updateCmds()};
  msg.oninput();
  msg.onkeydown=e=>{if(cmdKey(e))return;if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();composer.requestSubmit()}
    else if(e.key==='Backspace'&&!msg.selectionStart&&!msg.selectionEnd&&chips.length){chips.pop();saveChips();drawChips();msg.oninput()}};
  composer.onsubmit=async e=>{e.preventDefault();const text=[...chips.map(c=>c.ref),msg.value.trim()].filter(Boolean).join('\\n');if(!text)return;send.disabled=true;
    try{const r=await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminal:TERMINAL,text})});
      if(!r.ok)throw new Error(await r.text());
      msg.value='';chips=[];saveChips();drawChips();working();if(tab==='transcript')scrollTo(0,document.documentElement.scrollHeight)}
    catch(err){toast(send,'Not sent: '+(err.message||err))}
    msg.oninput();msg.focus()}}
// Terminal tab: xterm.js attached over a WebSocket to a tmux client the server runs for this outline's session.
let term;
const loadAsset=(tag,attrs)=>new Promise((ok,fail)=>{const el=Object.assign(document.createElement(tag),attrs);el.onload=ok;el.onerror=fail;document.head.appendChild(el)});
const openTerm=async()=>{if(term){term.focus();return}
  const box=document.getElementById('term');
  await Promise.all([loadAsset('link',{rel:'stylesheet',href:'/vendor/xterm.css'}),loadAsset('script',{src:'/vendor/xterm.js'})]);await loadAsset('script',{src:'/vendor/addon-fit.js'});
  term=new Terminal({fontFamily:'Menlo,Monaco,"SF Mono",monospace',fontSize:13,cursorBlink:true,allowProposedApi:true,theme:{background:'#0d1117'}});
  const fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(box);fit.fit();
  let ws;
  const send=m=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(m))};
  const connect=()=>{ws=new WebSocket('ws://'+location.host+'/term?s='+encodeURIComponent(TERMINAL)+'&cols='+term.cols+'&rows='+term.rows);
    ws.onmessage=e=>term.write(e.data);
    ws.onclose=()=>{term.write('\\r\\n\\x1b[2m[not attached to tmux session '+TERMINAL+'. Is it running? Press any key to retry.]\\x1b[0m\\r\\n');ws=null}};
  term.onData(d=>{if(!ws)return connect();send({t:'i',d})});
  term.onResize(({cols,rows})=>send({t:'r',c:cols,r:rows}));
  new ResizeObserver(()=>fit.fit()).observe(box);
  connect();term.focus()};
if(!document.querySelector('details,tr.r'))document.querySelectorAll('.outline-only').forEach(x=>x.style.display='none');
const all=open=>{document.querySelectorAll('details').forEach(d=>d.open=open);document.querySelectorAll('tr.r').forEach(r=>{if(r.nextElementSibling&&r.nextElementSibling.classList.contains('kids'))r.classList.toggle('closed',!open)})};
expand.onclick=()=>all(true);collapse.onclick=()=>all(false);
fire.onclick=()=>{const all=document.querySelectorAll((document.getElementById('outline-table')?'#outline-table ':'#outline ')+'.cur,details.s-fire,tr.s-fire');const d=document.querySelector('.cur')||all[all.length-1];if(!d)return;
  for(let e=d.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.tagName==='TR'&&e.classList.contains('kids'))e.previousElementSibling.classList.remove('closed')}
  if(d.tagName==='DETAILS')d.open=true;setTimeout(()=>scrollToNode(d),0)};
// Sticky, stackable headers: each topic / parent row sticks below its ancestors' headers until its own block ends.
const stickies=[...document.querySelectorAll('details.h>summary,tr.r.parent')];
const stackTop=()=>document.querySelector('.bar').offsetHeight;
const stickySet=new Set(stickies);
stickies.forEach(el=>{el._anc=[];for(let e=el.tagName==='SUMMARY'?el.parentElement.parentElement:el.parentElement;e;e=e.parentElement){
  const a=e.tagName==='DETAILS'&&e.classList.contains('h')?e.querySelector(':scope>summary'):e.tagName==='TR'&&e.classList.contains('kids')?e.previousElementSibling:null;
  if(a&&stickySet.has(a))el._anc.push(a)}});
let stickyQueued=false;
const markStuck=()=>{stickyQueued=false;const bar=stackTop();
  document.documentElement.style.setProperty('--barh',bar+'px');
  // Each header sticks below the real height of the headers above it, whatever the view makes them.
  stickies.forEach(el=>{el.style.zIndex=10-el._anc.length;el.style.setProperty('--top',bar+el._anc.reduce((n,a)=>n+a.offsetHeight,0)+'px')});
  stickies.forEach(el=>{const top=parseFloat(el.style.getPropertyValue('--top'));
    el.classList.toggle('stuck',el.getBoundingClientRect().top<=top+0.5&&el.parentElement.getBoundingClientRect().bottom>top+1)})};
const queueStuck=()=>{if(!stickyQueued){stickyQueued=true;requestAnimationFrame(markStuck)}};
addEventListener('scroll',queueStuck,{passive:true});addEventListener('resize',queueStuck);addEventListener('click',()=>setTimeout(queueStuck,0));markStuck();
const y=sessionStorage.getItem(KEY+':y');if(y)scrollTo(0,Number(y));
addEventListener('scroll',()=>sessionStorage.setItem(KEY+':y',String(scrollY)));
document.querySelectorAll('tr[data-href]').forEach(tr=>{const go=e=>{if(e.metaKey||e.ctrlKey)open(tr.dataset.href,'_blank');else location.href=tr.dataset.href};
  tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter')go(e)}});
const copyText=(text,btn)=>{try{navigator.clipboard.writeText(text)}catch(e){};const old=btn.textContent;btn.textContent='✓';setTimeout(()=>btn.textContent=old,1200)};
document.querySelectorAll('button[data-copy]').forEach(b=>b.onclick=e=>{e.stopPropagation();copyText(b.dataset.copy,b)});
const es=new EventSource('/events');
es.onmessage=()=>{if(LIVE_TABS.includes(tab))stale=true;else location.reload()};
</script></body></html>`
}

export { escapeHtml, countCheckboxProgress }
