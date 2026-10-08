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

/** Headings become nested <details>; list items that own a sub-list become <details> too. */
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
            headingStack.push(level)
            const text = src[i + 1].content
            out.push(html(detailsOpen(text, `h h${level}`) + '\n'))
            tok.tag = 'summary'
            out.push(tok)
            continue
        }
        if (tok.type === 'heading_close') {
            tok.tag = 'summary'
            out.push(tok)
            out.push(html('<div class="body">\n'))
            continue
        }

        if (tok.type === 'list_item_open') {
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
        out.push(tok)
    }
    closeHeadings(0)
    state.tokens = out
}

md.core.ruler.push('collapsible', collapsibleRule)

export function renderMarkdown(source) {
    return md.render(source)
}

export function renderPage({ title, bodyHtml, storageKey }) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--fire:#fff1e5;--fireline:#f0883e;--done:#8c959f;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--fire:#2d1b0e;--fireline:#db6d28;--done:#6e7681;--accent:#58a6ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:16px 20px 80px}
.bar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px;display:flex;gap:8px;align-items:center;z-index:2}
.bar a,.bar button{font:inherit;font-size:13px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:6px;padding:3px 10px;cursor:pointer;text-decoration:none}
.bar .t{margin-left:auto;color:var(--muted);font-size:12px}
h1{font-size:1.5em;margin:.6em 0}
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
.ask{margin-left:8px;opacity:0;font-size:12px;border:1px solid var(--line);border-radius:6px;background:none;cursor:pointer;padding:0 5px}
summary:hover .ask,.ask:focus{opacity:1}
</style></head><body>
<div class="bar"><a href="/">All outlines</a><button id="expand">Expand all</button><button id="collapse">Collapse all</button><button id="fire">Jump to 🔥</button><button id="onlyopen">Hide ✅</button><span class="t" id="live">live</span></div>
<main>${bodyHtml}</main>
<script>
const KEY=${JSON.stringify(storageKey)};
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}};
const state=load();
const path=d=>{const k=[];for(let e=d;e;e=e.parentElement&&e.parentElement.closest('details'))k.unshift(e.dataset.key);return k.join(' > ')};
document.querySelectorAll('details').forEach(d=>{const s=state[path(d)];if(s!==undefined)d.open=s;
  d.addEventListener('toggle',()=>{state[path(d)]=d.open;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}})});

document.querySelectorAll('details>summary').forEach(sm=>{const b=document.createElement('button');b.className='ask';b.textContent='💬';b.title='Copy a reference to paste into the chat';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const d=sm.parentElement;const ref='Re: outline "'+document.title+'" › '+path(d).split(' > ').join(' › ')+' — ';
    try{navigator.clipboard.writeText(ref)}catch(err){}
    b.textContent='✓';setTimeout(()=>b.textContent='💬',1200)};
  sm.appendChild(b)});
const all=open=>document.querySelectorAll('details').forEach(d=>d.open=open);
expand.onclick=()=>all(true);collapse.onclick=()=>all(false);
onlyopen.onclick=()=>{document.body.classList.toggle('only-open');onlyopen.textContent=document.body.classList.contains('only-open')?'Show ✅':'Hide ✅'};
fire.onclick=()=>{const d=document.querySelector('details.s-fire');if(!d)return;for(let e=d;e;e=e.parentElement&&e.parentElement.closest('details'))e.open=true;d.scrollIntoView({block:'center'})};
const y=sessionStorage.getItem(KEY+':y');if(y)scrollTo(0,Number(y));
addEventListener('scroll',()=>sessionStorage.setItem(KEY+':y',String(scrollY)));
const es=new EventSource('/events');
es.onmessage=()=>location.reload();
es.onerror=()=>{live.textContent='disconnected'};
</script></body></html>`
}

export { escapeHtml }
