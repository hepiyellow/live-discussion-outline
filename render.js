import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

const STATUS = [
    ['🔥', 'fire'],
    ['❓', 'open'],
    ['✅', 'done'],
]

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function statusOf(text) {
    for (const [emoji, name] of STATUS) if (text.trimStart().startsWith(emoji)) return name
    return ''
}

let Token
function html(content) {
    const t = new Token('html_block', '', 0)
    t.content = content
    return t
}

function detailsOpen(summaryText, extraClass) {
    const status = statusOf(summaryText)
    const cls = [extraClass, status && `s-${status}`].filter(Boolean).join(' ')
    // Done topics start collapsed; the page script restores the reader's own choices.
    const open = status === 'done' ? '' : ' open'
    return `<details class="${cls}" data-key="${escapeHtml(summaryText.trim())}"${open}>`
}


const SIDE_CHAT = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M8 5.5v3M6.5 7h3"/></svg>'
const NUM_RE = /^\s*(🔥|❓|✅)?\s*(\d+(?:\.\d+)*)?\s*([\s\S]*)$/

function closeOf(tokens, i) {
    for (let j = i + 1; j < tokens.length; j++) if (tokens[j].nesting === -1 && tokens[j].level === tokens[i].level) return j
    return tokens.length - 1
}

/** A bullet list becomes a table: number | title (bold) | content. Items with a sub-list get a nested table in a child row. */
function listToHtml(tokens, i, j, radio = false) {
    const rows = []
    for (let k = i + 1; k < j; k = closeOf(tokens, k) + 1) {
        const itemEnd = closeOf(tokens, k)
        let text = null
        let extra = ''
        let kids = ''
        let kidCount = 0
        for (let m = k + 1; m < itemEnd; m++) {
            const t = tokens[m]
            if (t.type === 'paragraph_open' && text === null) {
                text = tokens[m + 1].content
                m += 2
            } else if (t.type === 'bullet_list_open') {
                const end = closeOf(tokens, m)
                kids += listToHtml(tokens, m, end, text !== null && leadTags(text).has('options'))
                for (let x = m + 1; x < end; x = closeOf(tokens, x) + 1) kidCount++
                m = end
            } else {
                const end = t.nesting === 1 ? closeOf(tokens, m) : m
                extra += md.renderer.render(tokens.slice(m, end + 1), md.options, {})
                m = end
            }
        }
        rows.push(rowHtml(text || '', extra, kids, kidCount, radio))
    }
    return `<table class="ol"><tbody>\n${rows.join('')}</tbody></table>\n`
}

const CHECK_RE = /^\s*\[([ xXaA])\]\s*/
const TAG_RE = /^@(recommendation|recommended|options)\b\s*/i
const REC_MARK = /@recommendation\.\s*/i

/** Same agent / human / open classification as the table view (for index progress). */
function fileCheckFromBulletText(text) {
    const check = text.match(CHECK_RE)
    if (!check) return null
    text = text.slice(check[0].length)
    const [, , , afterNum] = text.match(NUM_RE)
    const mark = check[1].toLowerCase()
    let rest = afterNum
    const tags = new Set()
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) tags.add(t[1].toLowerCase())
    const bold = rest.match(/^\*\*([\s\S]+?)\*\*\s*([\s\S]*)$/)
    const body = bold ? bold[2] : rest
    const recAt = body.search(REC_MARK)
    if (mark === 'x') return 'done'
    if (mark === 'a' || recAt >= 0 || tags.has('recommended')) return 'agent'
    return 'open'
}

function countCheckboxProgress(source) {
    const counts = { total: 0, done: 0, agent: 0, open: 0 }
    for (const line of source.split('\n')) {
        const m = line.match(/^\s*[-*]\s+(.*)$/)
        if (!m) continue
        const kind = fileCheckFromBulletText(m[1])
        if (!kind) continue
        counts.total++
        counts[kind]++
    }
    return counts
}

/** The `@…` tags right after a bullet's checkbox and number. */
function leadTags(text) {
    const check = text.match(CHECK_RE)
    let rest = text.slice(check ? check[0].length : 0).match(NUM_RE)[3]
    const tags = new Set()
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) tags.add(t[1].toLowerCase())
    return tags
}

/** radio: this bullet is one option of an `@options` question, so the viewer draws a radio button. */
function rowHtml(text, extra, kids, kidCount = 0, radio = false) {
    // `- [ ] 2.1 @options **Title.** content`; legacy `- ✅ 2.1 …` / `- ❓ 2.1 …` still reads as checked / open.
    const check = text.match(CHECK_RE)
    if (check) text = text.slice(check[0].length)
    const [, emoji = '', num = '', afterNum] = text.match(NUM_RE)
    const mark = check ? check[1].toLowerCase() : emoji === '✅' ? 'x' : ' '
    let rest = afterNum
    const tags = new Set()
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) tags.add(t[1].toLowerCase())
    const bold = rest.match(/^\*\*([\s\S]+?)\*\*\s*([\s\S]*)$/)
    const title = bold ? bold[1] : ''
    const body = bold ? bold[2] : rest
    const recAt = body.search(REC_MARK)
    // A recommendation is the agent's own claim, so an open box that carries one shows as agent-approved.
    const fileCheck = mark === 'x' ? 'done' : mark === 'a' || recAt >= 0 || tags.has('recommended') ? 'agent' : 'open'
    const group = Boolean(kids) && tags.has('options')
    const checked = fileCheck === 'done'
    const prose = recAt < 0 ? body : body.slice(0, recAt).trim()
    const recommendation = recAt < 0 ? '' : body.slice(recAt).replace(REC_MARK, '').trim()
    const parts = num ? num.split('.') : []
    const chain = parts.map((_, n) => parts.slice(0, n + 1).join('.')).join(' › ')
    const label = `${num} ${title || rest.slice(0, 60)}`.trim()
    const recLine = recAt < 0
        ? ''
        : `<span class="rec-line"><span class="pill rec" title="A recommendation for this bullet">💡 Recommendation</span> ${md.renderInline(recommendation)}</span>`
    const content = md.renderInline(prose) + recLine + extra
    const count = kidCount
        ? `<span class="kc" role="button" tabindex="0" title="${kidCount} direct child${kidCount === 1 ? '' : 'ren'} — click the row to collapse or expand"><span>${kidCount}</span></span>`
        : ''
    const pill = group
        ? '<span class="pill pick" title="Choose exactly one of the options below">◉ Pick one</span>'
        : !kids && tags.has('options')
          ? '<span class="pill opt" title="Options proposed, no recommendation yet">❓ Options</span>'
          : ''
    const recPill = radio && tags.has('recommended')
        ? '<span class="pill rec" title="The option the agent recommends">💡 Recommended</span>'
        : ''
    const titleHtml = bold ? `${md.renderInline(title)}${pill ? ' ' + pill : ''}${recPill ? ' ' + recPill : ''}` : ''
    const cls = ['r', emoji === '🔥' && 's-fire', checked && 's-done', kids && checked && 'closed'].filter(Boolean).join(' ')
    const flags = (group ? ' data-group="options"' : '') + (radio ? ' data-opt="1"' : '') + (radio && tags.has('recommended') ? ' data-rec="1"' : '')
    const boxTitle = radio
        ? fileCheck === 'done' ? 'Chosen' : fileCheck === 'agent' ? 'Recommended — click to choose it' : 'Choose this option'
        : fileCheck === 'done' ? 'Approved' : fileCheck === 'agent' ? 'Agent-approved — click to queue a human approval' : 'Approve this bullet'
    return (
        `<tr class="${cls}" data-num="${escapeHtml(num)}" data-ref="${escapeHtml(label)}" data-check="${fileCheck}"${flags}>` +
        `<td class="n" title="${escapeHtml(chain)}"><div class="nh"><span class="nm">${escapeHtml(parts.length ? parts[parts.length - 1] : '')}</span>` +
        `<button class="ask" title="Open a side discussion on this bullet: copies its path (and any queued approvals)">${SIDE_CHAT}</button>${count}</div>` +
        `<div class="s"><input type="checkbox" class="ck${radio ? ' radio' : ''}"${fileCheck !== 'open' ? ' checked' : ''} title="${boxTitle}">` +
        `<span class="st">${emoji === '🔥' ? '🔥' : ''}</span></div></td>` +
        `<td class="t">${titleHtml}</td>` +
        `<td class="c">${content}</td></tr>\n` +
        (kids ? `<tr class="kids"><td colspan="3">${kids}</td></tr>\n` : '')
    )
}

/** Headings become nested <details>. Bullets view: list items that own a sub-list become <details>. Table view: bullet lists become number | title | content tables. */
function collapsibleRule(state) {
    Token = state.Token
    const src = state.tokens
    const out = []
    const headingStack = []
    const closeHeadings = level => {
        while (headingStack.length && headingStack[headingStack.length - 1] >= level) {
            headingStack.pop()
            out.push(html('</div></details>\n'))
        }
    }

    for (let i = 0; i < src.length; i++) {
        const tok = src[i]

        if (tok.type === 'heading_open') {
            const level = Number(tok.tag.slice(1))
            closeHeadings(level)
            if (level === 1) {
                out.push(tok)
                continue
            }
            headingStack.push(level)
            const text = src[i + 1].content
            out.push(html(detailsOpen(text, `h h${level}`) + '\n'))
            tok.tag = 'summary'
            out.push(tok)
            continue
        }
        if (tok.type === 'heading_close') {
            const level = Number(tok.tag.slice(1))
            if (level === 1) {
                out.push(tok)
                continue
            }
            tok.tag = 'summary'
            out.push(tok)
            out.push(html('<div class="body">\n'))
            continue
        }

        if (state.env.view !== 'table' && tok.type === 'list_item_open') {
            let depth = 0
            let hasSubList = false
            let paraIdx = -1
            let closeIdx = -1
            for (let j = i + 1; j < src.length; j++) {
                const t = src[j]
                if (t.nesting === 1) depth++
                if (t.nesting === -1) depth--
                if (depth < 0) {
                    closeIdx = j
                    break
                }
                if (depth === 1 && t.type === 'paragraph_open' && paraIdx < 0) paraIdx = j
                if (t.nesting === 1 && depth === 1 && (t.type === 'bullet_list_open' || t.type === 'ordered_list_open')) hasSubList = true
            }
            if (hasSubList && paraIdx >= 0) {
                const para = src[paraIdx]
                para.tag = 'summary'
                para.hidden = false
                src[paraIdx + 2].tag = 'summary'
                src[paraIdx + 2].hidden = false
                para.meta = { wrapDetails: detailsOpen(src[paraIdx + 1].content, 'li') }
                src[closeIdx].meta = { closeDetails: true }
            }
        }

        if (tok.type === 'paragraph_open' && tok.meta && tok.meta.wrapDetails) {
            out.push(html(tok.meta.wrapDetails + '\n'))
        }
        if (tok.type === 'list_item_close' && tok.meta && tok.meta.closeDetails) {
            out.push(html('</details>\n'))
        }

        if (state.env.view === 'table' && tok.type === 'bullet_list_open') {
            const end = closeOf(src, i)
            out.push(html(listToHtml(src, i, end)))
            i = end
            continue
        }
        out.push(tok)
    }
    closeHeadings(0)
    state.tokens = out
}

md.core.ruler.push('collapsible', collapsibleRule)

const mdPlain = new MarkdownIt({ html: false, linkify: true })

/** view: 'bullets' (collapsible nested lists) or 'table' (number | title | content). */
export function renderMarkdown(source, view = 'bullets') {
    return md.render(source, { view })
}

export function renderPlain(source) {
    return mdPlain.render(source)
}

export function renderPage({ title, bodyHtml, tableHtml, plainHtml, resume, model, storageKey }) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--fire:#fff1e5;--fireline:#f0883e;--done:#8c959f;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--fire:#2d1b0e;--fireline:#db6d28;--done:#6e7681;--accent:#58a6ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{padding-left:76px}
.rail{position:fixed;top:0;bottom:0;left:0;width:76px;border-right:1px solid var(--line);background:var(--bg);display:flex;flex-direction:column;align-items:center;padding-top:8px;z-index:4}
.rail a{display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;padding:8px 0;border-radius:8px;color:var(--fg);background:none;border:1px solid var(--line);font-size:11px;text-decoration:none}
.rail a:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
.rail svg{width:28px;height:28px}
main{max-width:860px;margin:0 auto;padding:16px 20px 80px}
.bar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px;display:flex;gap:8px;align-items:center;z-index:2}
.bar a,.bar button{font:inherit;font-size:13px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:3px 10px;cursor:pointer;text-decoration:none}
.bar .seg{display:inline-flex;padding:0;overflow:hidden}
.bar .seg span{padding:4px 12px;color:var(--muted)}
.bar .seg span+span{border-left:1px solid var(--line)}
.bar .seg span.on{color:var(--fg);font-weight:700;box-shadow:inset 0 -2px 0 var(--fg)}
.bar #copylink{margin-left:auto}
.bar .model{font-size:13px;color:var(--muted);white-space:nowrap}
.bar #copylink~.t{margin-left:0}
.bar .t{margin-left:auto;color:var(--muted);font-size:12px}
#outline>h1,#outline-table>h1{font-size:1.85em;font-weight:700;line-height:1.2;margin:0 0 .85em;letter-spacing:-.02em}
details{margin:4px 0}
details>summary{cursor:pointer;padding:3px 6px;border-radius:6px;list-style-position:inside}
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
table.ol{width:100%;border-collapse:collapse}
table.ol td{vertical-align:top;padding:4px 8px;border-bottom:1px solid var(--line)}
table.ol td.n{white-space:nowrap;width:1%;color:var(--muted);font-variant-numeric:tabular-nums;padding-right:8px}
table.ol .nh{display:flex;align-items:center;gap:2px}
table.ol .s{display:flex;align-items:center;margin-top:3px;min-height:14px}
table.ol td.t{font-weight:600;width:26%;padding-left:4px}
table.ol tr.kids>td{border-bottom:0;padding:0 0 4px 10px}
table.ol table.ol{border-left:2px solid var(--line)}
table.ol tr.parent{cursor:pointer}
table.ol .kc{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;margin-left:2px;border:1.5px solid var(--muted);border-radius:50%;color:var(--muted);vertical-align:middle;user-select:none}
table.ol .kc>span{font-size:.7em;font-variant-numeric:tabular-nums;line-height:1}
table.ol tr.closed .kc{background:var(--muted);color:var(--bg)}
table.ol tr.closed+tr.kids{display:none}
table.ol tr.s-fire>td{background:var(--fire)}
table.ol tr.s-fire>td.n{border-left:3px solid var(--fireline)}
table.ol tr.s-done>td{color:var(--done)}
body.only-open table.ol tr.s-done,body.only-open table.ol tr.s-done+tr.kids{display:none}
table.ol .ask{color:var(--fg);opacity:.8;margin-left:6px;display:inline-flex;align-items:center;vertical-align:middle;padding:2px 5px}
table.ol tr.s-done .ask{color:var(--done)}
table.ol .ck{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:14px;height:14px;margin:0 4px 0 0;vertical-align:-2px;cursor:pointer;border:1.5px solid var(--muted);border-radius:3px;background:transparent center/11px 11px no-repeat;display:inline-block}
table.ol .ck:checked,table.ol .ck.on{border-color:#2da44e;background-color:#2da44e;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='white' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
table.ol .ck.agent:checked,table.ol .ck.agent.on{border-color:var(--accent);background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%230969da' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){table.ol .ck.agent:checked,table.ol .ck.agent.on{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%2358a6ff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}}
table.ol .ck.pending:checked,table.ol .ck.pending.on{border-color:#2da44e;background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.4 6.2 4.8 8.6 9.6 3.4' fill='none' stroke='%232da44e' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
table.ol .ck.radio{border-radius:50%}
table.ol .ck.radio:checked,table.ol .ck.radio.on{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='white'/%3E%3C/svg%3E")}
table.ol .ck.radio.agent:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%230969da'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){table.ol .ck.radio.agent:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%2358a6ff'/%3E%3C/svg%3E")}}
table.ol .ck.radio.pending:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%232da44e'/%3E%3C/svg%3E")}
table.ol .ck:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
table.ol .cks-extra{display:inline-flex;align-items:center;vertical-align:middle}
table.ol .ck.echo{cursor:pointer}
table.ol .ck.rolled{position:absolute;width:1px;height:1px;opacity:0;margin:0;pointer-events:none}
table.ol .pill{display:inline-block;margin-left:6px;font-size:11px;font-weight:500;border-radius:10px;padding:0 7px;white-space:nowrap;vertical-align:1px;cursor:default;user-select:none}
table.ol .pill.rec{color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
table.ol .rec-line{display:block;margin-top:6px}
table.ol .rec-line .pill{margin:0 6px 0 0}
table.ol .pill.opt{color:#d1242f;background:color-mix(in srgb,#d1242f 14%,transparent)}
table.ol .pill.pick{color:var(--fg);background:color-mix(in srgb,var(--fg) 12%,transparent)}
@media (prefers-color-scheme:dark){table.ol .pill.pick{color:#fff;background:color-mix(in srgb,#fff 16%,transparent)}}
#status{position:fixed;left:76px;right:0;bottom:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 20px;background:var(--bg);border-top:1px solid var(--line);z-index:3}
.toast{position:fixed;transform:translate(-50%,-100%);background:var(--fg);color:var(--bg);font-size:12px;padding:3px 8px;border-radius:6px;pointer-events:none;z-index:5;white-space:nowrap}
#status[hidden]{display:none}
#status .tag{font-size:12px;border:1px solid #2da44e;background:#2da44e;color:#fff;border-radius:12px;padding:1px 4px 1px 9px;display:inline-flex;gap:4px;align-items:center}
#status .tag.reopen{background:transparent;color:#2da44e}
#status .tag button{border:0;background:none;color:inherit;cursor:pointer;font-size:13px;padding:0 3px}
#status .grow{flex:1}
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
#plain h1,#plain h2,#plain h3{margin:1.2em 0 .5em;line-height:1.25}
#plain h2{border-bottom:1px solid var(--line);padding-bottom:.25em}
#plain ul{list-style:disc}
#plain p{margin:.6em 0}
.ask{color:var(--fg);margin-left:8px;opacity:.55;font-size:12px;border:1px solid var(--line);border-radius:6px;background:none;cursor:pointer;padding:0 5px}
summary:hover .ask,li:hover>.ask,.ask:focus{opacity:1}
</style></head><body${tableHtml === undefined ? '' : ' class="has-table"'}>
<nav class="rail"><a href="/" title="All outlines"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Discussions</a></nav>
<div class="bar"><button id="mdview" class="seg" title="Switch between the collapsible outline and the plain rendered markdown"><span data-m="outline" class="on">Outline</span><span data-m="md">Markdown</span></button><button id="expand" class="outline-only">Expand all</button><button id="collapse" class="outline-only">Collapse all</button><button id="fire" class="outline-only">Jump to 🔥</button>${resume ? '<button id="copylink" title="Copy the link that reopens this chat">Copy chat link</button>' : ''}${model ? `<span class="model" title="Model and effort the agent wrote into the outline">${escapeHtml(model)}</span>` : ''}<span class="t" id="live">live</span></div>
${bodyHtml === undefined ? '' : `<main id="outline">${bodyHtml}</main>`}${tableHtml === undefined ? '' : `<main id="outline-table">${tableHtml}</main>`}${plainHtml === undefined ? '' : `<main id="plain">${plainHtml}</main>`}<div id="status" hidden></div>
<script>
const KEY=${JSON.stringify(storageKey)};
const RESUME=${JSON.stringify(resume || '').replace(/</g, '\\u003c')};
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}};
const state=load();
const path=d=>{const k=[];for(let e=d;e;e=e.parentElement&&e.parentElement.closest('details'))k.unshift(e.dataset.key);return k.join(' > ')};
document.querySelectorAll('details').forEach(d=>{const s=state[path(d)];if(s!==undefined)d.open=s;
  d.addEventListener('toggle',()=>{state[path(d)]=d.open;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}})});

document.querySelectorAll('details>summary').forEach(sm=>{const b=document.createElement('button');b.className='ask';b.textContent='📋';b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=sm.parentElement;const ref='Re: outline "'+document.title+'" › '+path(d).split(' > ').join(' › ')+' — ';
    try{navigator.clipboard.writeText(ref)}catch(err){}
    b.textContent='✓';setTimeout(()=>b.textContent='📋',1200)};
  sm.appendChild(b)});
document.querySelectorAll('#outline li').forEach(li=>{if(li.querySelector(':scope>details'))return;
  const b=document.createElement('button');b.className='ask';b.textContent='📋';b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=li.closest('details');const own=[...li.childNodes].filter(n=>!/^(UL|OL|BUTTON)$/.test(n.nodeName)).map(n=>n.textContent).join('').trim();
    const ref='Re: outline "'+document.title+'" › '+(d?path(d).split(' > ').join(' › ')+' › ':'')+own+' — ';
    try{navigator.clipboard.writeText(ref)}catch(err){}
    b.textContent='✓';setTimeout(()=>b.textContent='📋',1200)};
  li.insertBefore(b,li.querySelector(':scope>ul,:scope>ol'))});
const headPath=el=>{const d=el.closest('details');return d?path(d).split(' > ').join(' › ')+' › ':''};
const toast=el=>{document.querySelectorAll('.toast').forEach(t=>t.remove());const t=document.createElement('div');t.className='toast';t.textContent='Copied to clipboard';
  const r=el.getBoundingClientRect();t.style.left=r.left+r.width/2+'px';t.style.top=r.top-6+'px';document.body.appendChild(t);setTimeout(()=>t.remove(),2000)};
const rowKey=r=>'row:'+(r.dataset.num||r.dataset.ref);
const lsGet=k=>{try{return JSON.parse(localStorage.getItem(KEY+k)||'{}')}catch(e){return {}}};
const lsSet=(k,v)=>{try{localStorage.setItem(KEY+k,JSON.stringify(v))}catch(e){}};
const chk=lsGet(':chk'),sent=lsGet(':sent');   // chk: viewer overrides of the file's checkbox; sent: overrides already copied
const rows=[...document.querySelectorAll('tr.r')];
const fileCheck=r=>r.dataset.check||(r.dataset.checked==='1'?'done':'open');
const fileDone=r=>fileCheck(r)==='done';
const effective=r=>{const k=rowKey(r);return k in chk?chk[k]:fileDone(r)};
const childRows=r=>{const n=r.nextElementSibling;return n&&n.classList.contains('kids')?[...n.querySelectorAll(':scope > td > table.ol > tbody > tr.r')]:[]};
const descendants=r=>childRows(r).flatMap(k=>[k,...descendants(k)]);
const KIND_ORDER=['open','agent','pending','done'];
const KIND_TITLE={open:'Open',agent:'Agent-approved',pending:'Pending human approval',done:'Approved'};
const ownKind=r=>{const file=fileCheck(r),on=effective(r);
  if(on&&file!=='done')return 'pending';if(file==='done'&&on)return 'done';if(file==='agent')return 'agent';return 'open'};
const isGroup=r=>r.dataset.group==='options';
const parentRow=r=>{const k=r.closest('tr.kids');return k&&k.previousElementSibling};
const kindsOf=r=>{const kids=childRows(r);if(!kids.length)return [ownKind(r)];
  const seen={};kids.forEach(k=>kindsOf(k).forEach(kind=>{seen[kind]=1}));
  if(isGroup(r))return [['done','pending','agent'].find(k=>seen[k])||'open'];
  return KIND_ORDER.filter(k=>seen[k])};
const setWant=(r,want)=>{const key=rowKey(r);if(want===fileDone(r))delete chk[key];else chk[key]=want;delete sent[key]};
const choose=r=>{setWant(r,true);childRows(parentRow(r)).forEach(s=>{if(s!==r)setWant(s,false)})};
const paint=r=>{const box=r.querySelector('input.ck');const on=effective(r),file=fileCheck(r),opt=!!r.dataset.opt;
  const pendingOn=on&&file!=='done';const pendingOff=!on&&file==='done';
  const outvoted=opt&&!on&&childRows(parentRow(r)).some(s=>s!==r&&effective(s));
  box.checked=on||(file==='agent'&&!outvoted&&!(rowKey(r) in chk));
  box.classList.toggle('pending',pendingOn);box.classList.toggle('agent',file==='agent'&&!outvoted&&!pendingOn&&!pendingOff);
  box.title=opt
    ?(pendingOn?'Pending choice — filled once the agent records it':pendingOff?'Pending un-choose — cleared once the agent records it':file==='agent'?'Recommended — click to choose it':on?'Chosen':'Choose this option')
    :(pendingOn?'Pending approval — filled once the agent records it':pendingOff?'Pending reopen — cleared once the agent records it':file==='agent'?'Agent-approved — click to queue a human approval':on?'Approved':'Approve this bullet');
  const kids=childRows(r),kinds=kindsOf(r);
  let extra=r.querySelector('.cks-extra');
  if(!extra){extra=document.createElement('span');extra.className='cks-extra';box.after(extra);
    extra.onclick=e=>{e.preventDefault();box.click()}}
  extra.replaceChildren();
  if(kids.length){box.classList.add('rolled');
    kinds.forEach(kind=>{const s=document.createElement('span');s.className='ck echo'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');s.title=KIND_TITLE[kind];extra.appendChild(s)});
    r.classList.toggle('s-done',kinds.length===1&&kinds[0]==='done')}
  else{box.classList.remove('rolled');r.classList.toggle('s-done',on&&file==='done')}};
const paintTree=()=>rows.forEach(paint);
const pending=()=>rows.filter(r=>{const k=rowKey(r);return k in chk&&chk[k]!==fileDone(r)&&sent[k]!==chk[k]});
const approvalText=()=>{const p=pending();const f=(v,opt)=>p.filter(r=>effective(r)===v&&(opt===undefined||!!r.dataset.opt===opt)).map(r=>r.dataset.ref).join('; ');
  const a=f(true,false),c=f(true,true),o=f(false);
  const line=(lead,refs)=>refs&&lead+refs.replace(/\\.$/,'')+'.';
  return [line('Approved in the outline: ',a),line('Chosen in the outline: ',c),line('Reopened in the outline: ',o)].filter(Boolean).join('\\n')};
const sbar=document.getElementById('status');
const renderStatus=()=>{const p=pending();sbar.hidden=!p.length;sbar.innerHTML='';if(!p.length)return;
  p.forEach(r=>{const t=document.createElement('span');const on=effective(r);t.className='tag'+(on?'':' reopen');t.textContent=(on?(r.dataset.opt?'◉ ':'✓ '):'↺ ')+r.dataset.ref;
    const x=document.createElement('button');x.textContent='×';x.title='Drop this change';x.onclick=()=>{delete chk[rowKey(r)];lsSet(':chk',chk);paintTree();renderStatus()};t.appendChild(x);sbar.appendChild(t)});
  const g=document.createElement('span');g.className='grow';sbar.appendChild(g);
  const c=document.createElement('button');c.className='copyall';c.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10"/></svg> Copy to clipboard';
  c.onclick=()=>{copyApprovals(approvalText());c.textContent='✓ Copied'};sbar.appendChild(c)};
const copyApprovals=text=>{try{navigator.clipboard.writeText(text)}catch(e){};pending().forEach(r=>{sent[rowKey(r)]=effective(r)});lsSet(':sent',sent);setTimeout(renderStatus,600)};
rows.forEach(r=>{
  const k=r.nextElementSibling&&r.nextElementSibling.classList.contains('kids');
  if(k){const s=state[rowKey(r)];if(s!==undefined)r.classList.toggle('closed',!s);r.classList.add('parent');
    const flip=()=>{r.classList.toggle('closed');state[rowKey(r)]=!r.classList.contains('closed');try{localStorage.setItem(KEY,JSON.stringify(state))}catch(err){}};
    r.onclick=e=>{if(e.target.closest('input,button,a,.cks-extra')||String(getSelection()).trim())return;flip()};
    r.querySelector('.kc').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip()}}}
  const box=r.querySelector('input.ck');
  paint(r);
  box.onchange=()=>{const file=fileCheck(r);let want=box.checked||(file==='agent'&&!(rowKey(r) in chk));
    if(isGroup(r)){const kids=childRows(r),k=kindsOf(r)[0],pick=kids.find(c=>c.dataset.rec);
      want=k!=='pending'&&k!=='done'&&!!pick;
      if(want)choose(pick);else if(k==='pending'||k==='done')kids.forEach(c=>setWant(c,false))}
    else if(r.dataset.opt){if(want)choose(r);else setWant(r,false)}
    else [r,...descendants(r)].forEach(node=>setWant(node,want));
    lsSet(':chk',chk);lsSet(':sent',sent);paintTree();renderStatus();
    if(want){const text=approvalText();if(text){try{navigator.clipboard.writeText(text)}catch(e){}toast(box)}}};
  const b=r.querySelector('.ask');
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const ap=approvalText();
    try{navigator.clipboard.writeText((ap?ap+'\\n':'')+'Re: outline "'+document.title+'" › '+headPath(r)+r.dataset.ref+' — ')}catch(err){}
    pending().forEach(x=>{sent[rowKey(x)]=effective(x)});lsSet(':sent',sent);renderStatus();
    toast(b);}});
renderStatus();
const setMd=on=>{document.body.classList.toggle('show-md',on);mdview.querySelectorAll('span').forEach(x=>x.classList.toggle('on',(x.dataset.m==='md')===on));try{localStorage.setItem(KEY+':md',on?'1':'')}catch(e){}};
if(document.getElementById('plain')){mdview.onclick=()=>setMd(!document.body.classList.contains('show-md'));try{if(localStorage.getItem(KEY+':md'))setMd(true)}catch(e){}}else mdview.remove();
if(!document.querySelector('details,tr.r'))document.querySelectorAll('.outline-only').forEach(x=>x.style.display='none');
const all=open=>{document.querySelectorAll('details').forEach(d=>d.open=open);document.querySelectorAll('tr.r').forEach(r=>{if(r.nextElementSibling&&r.nextElementSibling.classList.contains('kids'))r.classList.toggle('closed',!open)})};
expand.onclick=()=>all(true);collapse.onclick=()=>all(false);
fire.onclick=()=>{const all=document.querySelectorAll((document.getElementById('outline-table')?'#outline-table ':'#outline ')+'details.s-fire,tr.s-fire');const d=all[all.length-1];if(!d)return;
  for(let e=d.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.tagName==='TR'&&e.classList.contains('kids'))e.previousElementSibling.classList.remove('closed')}
  if(d.tagName==='DETAILS')d.open=true;d.scrollIntoView({block:'center'})};
const y=sessionStorage.getItem(KEY+':y');if(y)scrollTo(0,Number(y));
addEventListener('scroll',()=>sessionStorage.setItem(KEY+':y',String(scrollY)));
document.querySelectorAll('tr[data-href]').forEach(tr=>{const go=e=>{if(e.metaKey||e.ctrlKey)open(tr.dataset.href,'_blank');else location.href=tr.dataset.href};
  tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter')go(e)}});
const copyText=(text,btn)=>{try{navigator.clipboard.writeText(text)}catch(e){};const old=btn.textContent;btn.textContent='✓';setTimeout(()=>btn.textContent=old,1200)};
const cl=document.getElementById('copylink');if(cl)cl.onclick=()=>copyText(RESUME,cl);
document.querySelectorAll('button[data-copy]').forEach(b=>b.onclick=e=>{e.stopPropagation();copyText(b.dataset.copy,b)});
const es=new EventSource('/events');
es.onmessage=()=>location.reload();
es.onerror=()=>{live.textContent='disconnected'};
</script></body></html>`
}

export { escapeHtml, countCheckboxProgress }
