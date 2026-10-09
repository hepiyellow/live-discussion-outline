import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

const STATUS = [
    ['🔥', 'fire'],
    ['❓', 'open'],
    ['✅', 'done'],
]

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function statusOf(text) {
    if (/(^|\s)@resolved\b/i.test(text)) return 'done'
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


const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10"/></svg>'
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
    // One <tbody> per row: it is the box a sticky parent row stays inside, until its last child has scrolled past.
    return `<table class="ol">\n${rows.map(row => `<tbody>${row}</tbody>\n`).join('')}</table>\n`
}

const CHECK_RE = /^\s*\[([ xXaA])\]\s*/
const TAG_RE = /^@(recommendation|recommended|options|current)\b\s*/i
const REC_MARK = /@recommendation\.\s*/i
const CURRENT_RE = /\s*@current\b\s*/i
const RESOLVED_RE = /\s*@resolved\b\s*/i
const LEAD_EMOJI_RE = /^\s*(🔥|❓|✅)\s*/

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
    const cls = ['r', emoji === '🔥' && 's-fire', tags.has('current') && 'cur', checked && 's-done', kids && checked && 'closed'].filter(Boolean).join(' ')
    const flags = (group ? ' data-group="options"' : '') + (radio ? ' data-opt="1"' : '') + (radio && tags.has('recommended') ? ' data-rec="1"' : '')
    const boxTitle = radio
        ? fileCheck === 'done' ? 'Chosen' : fileCheck === 'agent' ? 'Recommended — click to choose it' : 'Choose this option'
        : fileCheck === 'done' ? 'Approved' : fileCheck === 'agent' ? 'Agent-approved — click to queue a human approval' : 'Approve this bullet'
    return (
        `<tr class="${cls}" data-num="${escapeHtml(num)}" data-ref="${escapeHtml(label)}" data-check="${fileCheck}"${flags}>` +
        `<td class="n" title="${escapeHtml(chain)}"><div class="nh"><span class="tri" aria-hidden="true">${kids ? '▼' : ''}</span><span class="nm">${escapeHtml(parts.length ? parts[parts.length - 1] : '')}</span><span class="nf">${escapeHtml(num)}</span>` +
        `<button class="ask" title="Open a side discussion on this bullet: copies its path (and any queued approvals)">${COPY_ICON}</button>${count}</div>` +
        `<div class="s"><input type="checkbox" class="ck${radio ? ' radio' : ''}"${fileCheck !== 'open' ? ' checked' : ''} title="${boxTitle}">` +
        `</div></td>` +
        (kids
            ? `<td class="t">${titleHtml}</td></tr>\n` +
              `<tr class="kids"><td colspan="3">${content ? `<div class="pc">${content}</div>` : ''}${kids}</td></tr>\n`
            : `<td class="t">${titleHtml}</td><td class="c">${content}</td></tr>\n`)
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
            const inline = src[i + 1]
            // `@current` marks the bullet under discussion; the page highlights it and its ancestors. A legacy leading 🔥 does the same.
            const current = CURRENT_RE.test(inline.content)
            // Tags and legacy status emoji never show in the heading; the page draws their meaning.
            for (const c of inline.children || []) if (c.type === 'text') c.content = c.content.replace(CURRENT_RE, ' ').replace(RESOLVED_RE, ' ').replace(LEAD_EMOJI_RE, '')
            const text = inline.content.replace(CURRENT_RE, ' ').replace(/\s+/g, ' ')
            out.push(html(detailsOpen(text, `h h${level}${current ? ' cur' : ''}`) + '\n'))
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
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--fire:#fff1e5;--fireline:var(--fg);--done:#8c959f;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--fire:#2d1b0e;--fireline:var(--fg);--done:#6e7681;--accent:#58a6ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{padding-left:76px}
.rail{position:fixed;top:0;bottom:0;left:0;width:76px;border-right:1px solid var(--line);background:var(--bg);display:flex;flex-direction:column;align-items:center;padding-top:8px;z-index:4}
.rail a{display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;padding:8px 0;border-radius:8px;color:var(--fg);background:none;border:1px solid var(--line);font-size:11px;text-decoration:none}
.rail a:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
.rail svg{width:28px;height:28px}
main{max-width:860px;margin:0 auto;padding:16px 20px 80px}
.bar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px;display:flex;gap:8px;align-items:center;z-index:20}
.bar a,.bar button{font:inherit;font-size:13px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:3px 10px;cursor:pointer;text-decoration:none}
.bar .seg{display:inline-flex;padding:0;overflow:hidden}
.bar .seg span{padding:4px 10px;color:var(--muted);display:inline-flex;align-items:center}
.bar button.icon{display:inline-flex;align-items:center;padding:3px 6px}
.bar .seg span+span{border-left:1px solid var(--line)}
.bar .seg span.on{color:var(--fg);font-weight:700;box-shadow:inset 0 -2px 0 var(--fg)}
.bar #copylink{margin-left:auto}
.bar .model{font-size:13px;color:var(--muted);white-space:nowrap}
.bar #copylink~.t{margin-left:0}
.bar .t{margin-left:auto;color:var(--muted);font-size:12px}
#outline>h1,#outline-table>h1{font-size:1.85em;font-weight:700;line-height:1.2;margin:0 0 .85em;letter-spacing:-.02em}
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
table.ol tr.kids>td{border-bottom:0;padding:0 0 4px 10px}
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
body.bubbles table.ol tr.r.parent{grid-template-columns:28px 22px auto minmax(0,max-content) auto minmax(0,1fr) auto auto;grid-template-areas:"ck tri num title ask . kc tags";align-items:center;border-bottom:1px solid var(--line);margin:0}
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
table.ol .pill.rec{color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
table.ol .rec-line{display:block;margin-top:6px}
table.ol .rec-line .pill{margin:0 6px 0 0}
table.ol .pill.opt{color:#d1242f;background:color-mix(in srgb,#d1242f 14%,transparent)}
table.ol .pill.pick{color:var(--fg);background:color-mix(in srgb,var(--fg) 12%,transparent)}
@media (prefers-color-scheme:dark){table.ol .pill.pick{color:#fff;background:color-mix(in srgb,#fff 16%,transparent)}}
#status{position:fixed;left:76px;right:0;bottom:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 20px;background:var(--bg);border-top:1px solid var(--line);z-index:3}
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
#plain h1,#plain h2,#plain h3{margin:1.2em 0 .5em;line-height:1.25}
#plain h2{border-bottom:1px solid var(--line);padding-bottom:.25em}
#plain ul{list-style:disc}
#plain p{margin:.6em 0}
.ask{color:var(--muted);margin-left:8px;opacity:.7;border:0;border-radius:6px;background:none;cursor:pointer;padding:2px 4px;display:inline-flex;align-items:center;vertical-align:middle;line-height:1}
.ask:hover{color:var(--fg);background:color-mix(in srgb,var(--line) 40%,transparent)}
summary:hover .ask,li:hover>.ask,.ask:focus{opacity:1}
</style></head><body${tableHtml === undefined ? '' : ' class="has-table"'}>
<nav class="rail"><a href="/" title="All outlines"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Discussions</a></nav>
<div class="bar"><button id="bview" class="seg outline-only" title="Show leaves as table rows or as chat bubbles"><span data-b="table" class="on" title="Table"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6 6.5V13"/></svg></span><span data-b="bubbles" title="Bubbles"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h6.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H6L3.5 10V8H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M12.5 6h.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-.5v2l-2.5-2H7.5a1 1 0 0 1-1-1V10"/></svg></span></button><button id="mdview" class="seg" title="Switch between the collapsible outline and the plain rendered markdown"><span data-m="outline" class="on" title="Outline"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5h2M6.5 3.5H14M4.5 8h2M9 8h5M4.5 12.5h2M9 12.5h5"/></svg></span><span data-m="md" title="Markdown"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 10V6l2 2 2-2v4M11.5 6v4M10 8.5l1.5 1.5L13 8.5"/></svg></span></button><button id="expand" class="outline-only icon" title="Expand all" aria-label="Expand all"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1"/><rect x="2" y="5" width="9" height="9" rx="1"/><path d="M4.5 9.5h4M6.5 7.5v4"/></svg></button><button id="collapse" class="outline-only icon" title="Collapse all" aria-label="Collapse all"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1"/><rect x="2" y="5" width="9" height="9" rx="1"/><path d="M4.5 9.5h4"/></svg></button><button id="fire" class="outline-only icon" title="Jump to the current bullet" aria-label="Jump to the current bullet"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg></button>${resume ? '<button id="copylink" title="Copy the link that reopens this chat">Copy chat link</button>' : ''}${model ? `<span class="model" title="Model and effort the agent wrote into the outline">${escapeHtml(model)}</span>` : ''}<span class="t" id="live">live</span></div>
${bodyHtml === undefined ? '' : `<main id="outline">${bodyHtml}</main>`}${tableHtml === undefined ? '' : `<main id="outline-table">${tableHtml}</main>`}${plainHtml === undefined ? '' : `<main id="plain">${plainHtml}</main>`}<div id="status" hidden></div>
<script>
const KEY=${JSON.stringify(storageKey)};
const COPY_ICON=${JSON.stringify(COPY_ICON)};
const RESUME=${JSON.stringify(resume || '').replace(/</g, '\\u003c')};
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}};
const state=load();
const path=d=>{const k=[];for(let e=d;e;e=e.parentElement&&e.parentElement.closest('details'))k.unshift(e.dataset.key);return k.join(' > ')};
document.querySelectorAll('details').forEach(d=>{const s=state[path(d)];if(s!==undefined)d.open=s;
  d.addEventListener('toggle',()=>{state[path(d)]=d.open;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}})});

document.querySelectorAll('details>summary').forEach(sm=>{const b=document.createElement('button');b.className='ask';b.innerHTML=COPY_ICON;b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=sm.parentElement;const ref='Re: outline "'+document.title+'" › '+path(d).split(' > ').join(' › ')+' — ';
    try{navigator.clipboard.writeText(ref)}catch(err){}
    b.textContent='✓';setTimeout(()=>b.innerHTML=COPY_ICON,1200)};
  sm.appendChild(b)});
document.querySelectorAll('#outline li').forEach(li=>{if(li.querySelector(':scope>details'))return;
  const b=document.createElement('button');b.className='ask';b.innerHTML=COPY_ICON;b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=li.closest('details');const own=[...li.childNodes].filter(n=>!/^(UL|OL|BUTTON)$/.test(n.nodeName)).map(n=>n.textContent).join('').trim();
    const ref='Re: outline "'+document.title+'" › '+(d?path(d).split(' > ').join(' › ')+' › ':'')+own+' — ';
    try{navigator.clipboard.writeText(ref)}catch(err){}
    b.textContent='✓';setTimeout(()=>b.innerHTML=COPY_ICON,1200)};
  li.insertBefore(b,li.querySelector(':scope>ul,:scope>ol'))});
const headPath=el=>{const d=el.closest('details');return d?path(d).split(' > ').join(' › ')+' › ':''};
const toast=el=>{document.querySelectorAll('.toast').forEach(t=>t.remove());const t=document.createElement('div');t.className='toast';t.textContent='Copied to clipboard';
  const r=el.getBoundingClientRect();t.style.left=r.left+r.width/2+'px';t.style.top=r.top-6+'px';document.body.appendChild(t);setTimeout(()=>t.remove(),2000)};
const rowKey=r=>'row:'+(r.dataset.num||r.dataset.ref);
const lsGet=k=>{try{return JSON.parse(localStorage.getItem(KEY+k)||'{}')}catch(e){return {}}};
const lsSet=(k,v)=>{try{localStorage.setItem(KEY+k,JSON.stringify(v))}catch(e){}};
const chk=lsGet(':chk'),sent=lsGet(':sent');   // chk: viewer overrides of the file's checkbox; sent: overrides already copied
const rows=[...document.querySelectorAll('tr.r')];
// The bullet tagged @current and every ancestor on its path get the orange current-path line.
document.querySelectorAll('.cur').forEach(c=>{for(let e=c;e;e=e.parentElement){if(e.matches('details.h'))e.classList.add('s-fire');if(e.matches('tr.kids'))e.previousElementSibling.classList.add('s-fire')}if(c.matches('tr.r'))c.classList.add('s-fire')});
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
// Everything approved, some of it still waiting for the agent to record it, reads as pending; otherwise differing states are mixed.
const aggOf=kinds=>kinds.every(k=>k==='done'||k==='pending')?(kinds.includes('pending')?'pending':'done'):kinds.length>1?'mixed':kinds[0];
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
  if(!extra){extra=document.createElement('span');extra.className='cks-extra';box.after(extra);    }
  extra.replaceChildren();
  if(kids.length){const agg=aggOf(kinds),mixed=agg==='mixed';
    box.classList.remove('rolled');
    box.checked=agg==='agent'||agg==='pending'||agg==='done';
    box.classList.toggle('agent',agg==='agent');box.classList.toggle('pending',agg==='pending');box.classList.toggle('mixed',mixed);
    box.title=mixed?'Mixed: children are '+kinds.map(k=>KIND_TITLE[k].toLowerCase()).join(', ')+' — click to approve all':KIND_TITLE[agg];
    if(mixed)kinds.forEach(kind=>{const s=document.createElement('span');s.className='tagico ck'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');s.title=KIND_TITLE[kind];extra.appendChild(s)});
    r.classList.toggle('s-done',kinds.length===1&&kinds[0]==='done')}
  else{box.classList.remove('rolled');r.classList.toggle('s-done',(on&&file==='done')||(opt&&kindsOf(parentRow(r))[0]==='done'))}};
// Topic headings carry the same rolled-up checkbox as parent rows, over every bullet inside them.
const heads=[...document.querySelectorAll('#outline-table details.h')].map(d=>{
  const sm=d.querySelector(':scope>summary'),box=document.createElement('input');box.type='checkbox';box.className='ck';
  const extra=document.createElement('span');extra.className='cks-extra';
  sm.prepend(box);sm.querySelector('.ask')?sm.querySelector('.ask').before(extra):sm.append(extra);
  const top=()=>[...d.querySelectorAll('tr.r')].filter(r=>!parentRow(r));
  box.onclick=e=>{e.preventDefault();e.stopPropagation();const want=!(box.dataset.agg==='done'||box.dataset.agg==='pending');
    rows.filter(r=>d.contains(r)&&!r.dataset.opt&&!isGroup(r)).forEach(r=>setWant(r,want));
    lsSet(':chk',chk);lsSet(':sent',sent);paintTree();setTimeout(paintTree,0);renderStatus();
    if(want){const text=approvalText();if(text){try{navigator.clipboard.writeText(text)}catch(err){}toast(box)}}};
  return {d,box,extra,top}});
const paintHeads=()=>heads.forEach(({d,box,extra,top})=>{
  const seen={};top().forEach(r=>kindsOf(r).forEach(k=>{seen[k]=1}));
  const kinds=KIND_ORDER.filter(k=>seen[k]),agg=kinds.length?aggOf(kinds):'open',mixed=agg==='mixed';
  box.dataset.agg=agg;box.checked=agg==='agent'||agg==='pending'||agg==='done';
  box.classList.toggle('agent',agg==='agent');box.classList.toggle('pending',agg==='pending');box.classList.toggle('mixed',mixed);
  box.title=mixed?'Mixed: '+kinds.map(k=>KIND_TITLE[k].toLowerCase()).join(', ')+' — click to approve all':KIND_TITLE[agg];
  extra.replaceChildren();
  if(mixed)kinds.forEach(kind=>{const t=document.createElement('span');t.className='tagico ck'+(kind==='open'?'':kind==='agent'?' agent on':kind==='pending'?' pending on':' on');t.title=KIND_TITLE[kind];extra.appendChild(t)})});
const paintTree=()=>{rows.forEach(paint);paintHeads()};
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
  const x=document.createElement('button');x.className='clearall';x.textContent='Clear all';x.title='Drop every queued change';
  x.onclick=()=>{p.forEach(r=>{delete chk[rowKey(r)]});lsSet(':chk',chk);paintTree();renderStatus()};sbar.appendChild(x);
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
paintHeads();renderStatus();
const setBub=on=>{document.body.classList.toggle('bubbles',on);bview.querySelectorAll('span').forEach(x=>x.classList.toggle('on',(x.dataset.b==='bubbles')===on));try{localStorage.setItem(KEY+':bub',on?'1':'')}catch(e){};setTimeout(()=>dispatchEvent(new Event('resize')),0)};
if(document.getElementById('outline-table')){bview.onclick=()=>setBub(!document.body.classList.contains('bubbles'));try{if(localStorage.getItem(KEY+':bub'))setBub(true)}catch(e){}}else bview.remove();
const setMd=on=>{document.body.classList.toggle('show-md',on);mdview.querySelectorAll('span').forEach(x=>x.classList.toggle('on',(x.dataset.m==='md')===on));try{localStorage.setItem(KEY+':md',on?'1':'')}catch(e){}};
if(document.getElementById('plain')){mdview.onclick=()=>setMd(!document.body.classList.contains('show-md'));try{if(localStorage.getItem(KEY+':md'))setMd(true)}catch(e){}}else mdview.remove();
if(!document.querySelector('details,tr.r'))document.querySelectorAll('.outline-only').forEach(x=>x.style.display='none');
const all=open=>{document.querySelectorAll('details').forEach(d=>d.open=open);document.querySelectorAll('tr.r').forEach(r=>{if(r.nextElementSibling&&r.nextElementSibling.classList.contains('kids'))r.classList.toggle('closed',!open)})};
expand.onclick=()=>all(true);collapse.onclick=()=>all(false);
fire.onclick=()=>{const all=document.querySelectorAll((document.getElementById('outline-table')?'#outline-table ':'#outline ')+'.cur,details.s-fire,tr.s-fire');const d=document.querySelector('.cur')||all[all.length-1];if(!d)return;
  for(let e=d.parentElement;e;e=e.parentElement){if(e.tagName==='DETAILS')e.open=true;if(e.tagName==='TR'&&e.classList.contains('kids'))e.previousElementSibling.classList.remove('closed')}
  if(d.tagName==='DETAILS')d.open=true;d.scrollIntoView({block:'center'})};
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
const cl=document.getElementById('copylink');if(cl)cl.onclick=()=>copyText(RESUME,cl);
document.querySelectorAll('button[data-copy]').forEach(b=>b.onclick=e=>{e.stopPropagation();copyText(b.dataset.copy,b)});
const es=new EventSource('/events');
es.onmessage=()=>location.reload();
es.onerror=()=>{live.textContent='disconnected'};
</script></body></html>`
}

export { escapeHtml, countCheckboxProgress }
