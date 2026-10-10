// The unread-diff animation, ported from the old page. Opening a changed node shows what changed as a cursor passing
// through its text from the start: it scans over unchanged words quickly; added words grow in one by one in green,
// pushing the rest along, and fade to nothing; removed words, in red, collapse one by one; rewritten words collapse
// while the new ones grow in beside them (white, fading out). It works on the DOM of the node's cells directly, whose
// children React does not manage (they are server HTML).

type Block = { k: 'eq' | 'add' | 'del' | 'chg'; a: [number, number]; b: [number, number] }
type Step = { k: 'eq'; stops: [Text, number][]; spans: HTMLElement[] } | { k: 'add' | 'del' | 'chg'; add: HTMLElement[]; old: HTMLElement[] }

const words = (t: string) => t.split(/(\s+)/).filter(Boolean)

/**
 * The text as blocks in order: unchanged ('eq'), 'add', 'del' and 'chg' (words replaced by others), each with its
 * character range in the old text (a) and in the new text (b). Null when the texts are too long to compare.
 */
function diffWords(a: string[], b: string[]): Block[] | null {
    const n = a.length
    const m = b.length
    if (n * m > 250000) return null
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    const ops: [string, number, number][] = []
    for (let i = 0, j = 0; i < n || j < m; ) {
        if (i < n && j < m && a[i] === b[j]) ops.push(['=', a[i++].length, b[j++].length])
        else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) ops.push(['+', 0, b[j++].length])
        else ops.push(['-', a[i++].length, 0])
    }
    const blocks: Block[] = []
    let ao = 0
    let bo = 0
    for (let k = 0; k < ops.length; ) {
        const as = ao
        const bs = bo
        const eq = ops[k][0] === '='
        while (k < ops.length && (ops[k][0] === '=') === eq) {
            ao += ops[k][1]
            bo += ops[k][2]
            k++
        }
        blocks.push({ k: eq ? 'eq' : ao > as && bo > bs ? 'chg' : ao > as ? 'del' : 'add', a: [as, ao], b: [bs, bo] })
    }
    return blocks
}

/**
 * Wraps character ranges of root's text (ascending, not overlapping) in spans, one per text node they touch (last
 * first, so earlier offsets hold); returns each range's spans in document order.
 */
function wrapGroups(root: Element, ranges: [number, number][]) {
    const nodes: [Text, number, number][] = []
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let off = 0, n: Node | null; (n = walk.nextNode()); ) {
        const t = n as Text
        nodes.push([t, off, off + t.data.length])
        off += t.data.length
    }
    const pieces: [number, Text, number, number][] = []
    ranges.forEach(([s, e], gi) =>
        nodes.forEach(([n, s0, e0]) => {
            const ls = Math.max(s, s0)
            const le = Math.min(e, e0)
            if (le > ls) pieces.push([gi, n, ls - s0, le - s0])
        }),
    )
    const groups: HTMLElement[][] = ranges.map(() => [])
    pieces.reverse().forEach(([gi, n, ls, le]) => {
        const rg = document.createRange()
        const sp = document.createElement('span')
        rg.setStart(n, ls)
        rg.setEnd(n, le)
        rg.surroundContents(sp)
        groups[gi].unshift(sp)
    })
    return groups
}

/** Splits a span's text into units (a word with the space after it), each of which can grow in or collapse on its own. */
function unitize(sp: HTMLElement, text = sp.textContent ?? '') {
    const pre = !!sp.closest('pre')
    sp.textContent = ''
    return (text.match(/\S+\s*|\s+/g) || []).map(t => {
        const u = document.createElement('span')
        u.className = 'tx-u'
        u.textContent = pre ? t : t.replace(/\s+/g, ' ')
        sp.appendChild(u)
        return u
    })
}

/**
 * Puts a cell's new content in place so that it reads as the old one: removed words come back as red ghosts at their
 * place, added words are hidden. Returns the steps in text order.
 */
function stageCell(c: HTMLElement, diff: Block[], oldText: string): Step[] {
    const groups = wrapGroups(
        c,
        diff.filter(b => b.b[1] > b.b[0]).map(b => b.b),
    )
    let gi = 0
    const steps: Step[] = []
    diff.forEach(b => {
        const spans = b.b[1] > b.b[0] ? groups[gi++] : []
        if (b.k === 'eq') {
            const stops: [Text, number][] = []
            spans.forEach(sp => {
                sp.className = 'tx-q'
                const n = sp.firstChild
                const re = /\S+/g
                let m
                while (n && n.nodeType === 3 && (m = re.exec((n as Text).data))) stops.push([n as Text, m.index + m[0].length])
            })
            steps.push({ k: 'eq', stops, spans })
            return
        }
        const add = spans.flatMap(sp => {
            sp.className = `tx-n${b.k === 'chg' ? ' c' : ''}`
            return unitize(sp)
        })
        let old: HTMLElement[] = []
        if (b.a[1] > b.a[0]) {
            const g = document.createElement('span')
            g.className = 'tx-o'
            if (add.length) spans[0].before(g)
            else {
                const prev = steps[steps.length - 1]
                const last = prev && prev.k === 'eq' ? prev.spans[prev.spans.length - 1] : undefined
                if (last) last.after(g)
                else c.prepend(g)
            }
            old = unitize(g, oldText.slice(b.a[0], b.a[1]))
        }
        steps.push({ k: b.k, add, old })
    })
    // A block whose words are all still hidden (a new paragraph or list item) is hidden too, until its first word comes in.
    c.querySelectorAll('p,li,pre,blockquote,ul,ol,h1,h2,h3,h4,h5,h6,table,tr').forEach(e => {
        if (!e.textContent?.trim()) return
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
        let shown = false
        for (let n: Node | null; (n = w.nextNode()); )
            if ((n as Text).data.trim() && !n.parentElement?.closest('.tx-n')) {
                shown = true
                break
            }
        if (!shown) e.classList.add('tx-hide')
    })
    return steps
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
const frames = (ms: number, fn: (p: number) => void) =>
    new Promise<void>(res => {
        const t0 = performance.now()
        const f = (now: number) => {
            const p = Math.min(1, (now - t0) / ms)
            fn(p)
            if (p < 1) requestAnimationFrame(f)
            else res()
        }
        requestAnimationFrame(f)
    })

/**
 * Animates cells (title, text) from what they show now to new HTML. Resolves once they hold the new HTML; without a
 * change to show, on a hidden page, or with reduced motion, the HTML just changes.
 */
export async function animateTo(cells: HTMLElement[], parts: string[]) {
    const olds = cells.map(c => c.textContent ?? '')
    const diffs = cells.map((_, i) => {
        const t = document.createElement('div')
        t.innerHTML = parts[i]
        return diffWords(words(olds[i]), words(t.textContent ?? ''))
    })
    const changed = (d: Block[] | null) => !!d && d.some(b => b.k !== 'eq')
    const settle = () => cells.forEach((c, i) => (c.innerHTML = parts[i]))
    // Nobody is watching a hidden page (and it would not draw frames), or wants motion: the text just changes.
    if (!diffs.some(changed) || document.visibilityState !== 'visible' || matchMedia('(prefers-reduced-motion: reduce)').matches) return settle()
    const cur = document.createElement('div')
    cur.className = 'tx-cur'
    cur.style.opacity = '0'
    document.body.appendChild(cur)
    let placed = false
    const put = (rc: { left: number; top: number; height: number; width: number } | undefined) => {
        if (!rc || (!rc.height && !rc.width)) return
        if (!placed) cur.style.transition = 'none'
        cur.style.height = `${rc.height}px`
        cur.style.transform = `translate(${rc.left}px,${rc.top}px)`
        if (!placed) {
            placed = true
            cur.style.opacity = '1'
            void cur.offsetWidth
            cur.style.transition = ''
        }
    }
    const edge = (el: Element, end: boolean) => {
        const rc = el.getBoundingClientRect()
        return { left: end ? rc.right : rc.left, top: rc.top, height: rc.height, width: 0 }
    }
    const at = (n: Text, o: number) => {
        const rg = document.createRange()
        rg.setStart(n, o)
        rg.collapse(true)
        return rg.getClientRects()[0] || rg.getBoundingClientRect()
    }
    try {
        const stages = cells.map((c, i) => {
            c.innerHTML = parts[i]
            return changed(diffs[i]) ? stageCell(c, diffs[i]!, olds[i]) : null
        })
        // The more there is to show, the faster the cursor goes.
        const load = stages.reduce((n, st) => n + (st ? st.reduce((m, s) => m + (s.k === 'eq' ? s.stops.length / 6 : s.add.length + s.old.length), 0) : 0), 0)
        const speed = Math.min(4, Math.max(1, load / 50))
        const grow = (u: HTMLElement, cell: HTMLElement) => {
            for (let e: HTMLElement | null = u.parentElement; e; e = e.parentElement) {
                e.classList.remove('tx-hide')
                if (e === cell) break
            }
            u.classList.add('on')
            const w = u.getBoundingClientRect().width
            u.animate([{ maxWidth: '0px', opacity: 0 }, { maxWidth: `${w}px`, opacity: 1 }], { duration: 130 / speed, easing: 'ease-out' })
        }
        const shrink = (u: HTMLElement) => {
            const w = u.getBoundingClientRect().width
            u.animate([{ maxWidth: `${w}px`, opacity: 1 }, { maxWidth: '0px', opacity: 0 }], { duration: 110 / speed, easing: 'ease-in', fill: 'forwards' })
        }
        for (let i = 0; i < cells.length; i++) {
            const st = stages[i]
            if (!st) continue
            for (const s of st) {
                if (s.k === 'eq') {
                    const n = s.stops.length
                    if (!n) continue
                    await frames(Math.min(500, Math.max(60, n * 9)) / speed, p => {
                        const [node, off] = s.stops[Math.min(n - 1, Math.floor(p * n))]
                        put(at(node, off))
                    })
                    continue
                }
                if (s.old.length) {
                    put(edge(s.old[0], false))
                    await sleep(90 / speed)
                }
                const n = Math.max(s.old.length, s.add.length)
                for (let j = 0; j < n; j++) {
                    const o = s.old[j]
                    const a = s.add[j]
                    if (o) shrink(o)
                    if (a) grow(a, cells[i])
                    const dur = (s.k === 'add' ? 36 : s.k === 'del' ? 28 : 42) / speed
                    await frames(dur, () => put(a ? edge(a, true) : edge(o, false)))
                }
                await sleep(40 / speed)
            }
        }
        // The last words are still fading; the cursor leaves once they have.
        await sleep(800 / Math.min(speed, 2))
        cur.style.opacity = '0'
        await sleep(160)
    } finally {
        settle()
        cur.remove()
    }
}
