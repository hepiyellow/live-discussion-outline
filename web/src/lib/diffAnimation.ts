// The unread-diff animation. Opening a changed node shows what changed in up to four stages of half a second each,
// however long the text is; a stage with nothing to show is skipped:
//   1. the text reads as it did, with the words about to go marked: red for removed ones, orange for rewritten ones;
//   2. the removed words collapse, all at once, with no cursor;
//   3. a cursor passes over the rewritten words: each collapses while the new one grows in beside it, in orange;
//   4. the cursor passes over the added words: they grow in one by one in green, pushing the rest along.
// The colour of a word that came in fades to nothing. It works on the DOM of the node's cells directly, whose children
// React does not manage (they are server HTML).

type Block = { k: 'eq' | 'add' | 'del' | 'chg'; a: [number, number]; b: [number, number] }
type Change = { k: 'add' | 'del' | 'chg'; add: HTMLElement[]; old: HTMLElement[] }
type Step = { k: 'eq'; spans: HTMLElement[] } | Change

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
 * place, rewritten ones as orange ghosts, and added words are hidden. Returns the steps in text order.
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
            spans.forEach(sp => (sp.className = 'tx-q'))
            steps.push({ k: 'eq', spans })
            return
        }
        const add = spans.flatMap(sp => {
            sp.className = `tx-n${b.k === 'chg' ? ' c' : ''}`
            return unitize(sp)
        })
        let old: HTMLElement[] = []
        if (b.a[1] > b.a[0]) {
            const g = document.createElement('span')
            g.className = `tx-o${b.k === 'chg' ? ' c' : ''}`
            if (add.length) spans[0].before(g)
            else {
                const prev = steps[steps.length - 1]
                const last = prev && prev.k === 'eq' ? prev.spans[prev.spans.length - 1] : undefined
                if (last) last.after(g)
                else c.prepend(g)
            }
            old = unitize(g, oldText.slice(b.a[0], b.a[1]))
        }
        // Rewritten words go one for one. Where the new text has more words, the rest are added ones; where the old
        // text has more, the rest are removed ones: each is marked and animated as such.
        const pairs = b.k === 'chg' ? Math.min(old.length, add.length) : 0
        const more = b.k === 'chg' ? [...old.slice(pairs), ...add.slice(pairs)] : []
        more.forEach(u => u.classList.add('x'))
        steps.push({ k: b.k, add: b.k === 'chg' ? add.slice(0, pairs) : add, old: b.k === 'chg' ? old.slice(0, pairs) : old })
        if (old.length > pairs && b.k === 'chg') steps.push({ k: 'del', add: [], old: old.slice(pairs) })
        if (add.length > pairs && b.k === 'chg') steps.push({ k: 'add', add: add.slice(pairs), old: [] })
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

/** Waits `ms`, or until `signal` aborts. */
export const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>(res => {
        if (signal?.aborted) return res()
        const timer = setTimeout(res, ms)
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer)
                res()
            },
            { once: true },
        )
    })

/** How long each stage takes: the marks, the removal, the pass over rewritten words, the pass over added words. */
const STAGE = 500
/** How long a word's colour takes to fade once it came in (`--tx-fade`). */
const FADE = 280
const CURSOR_OUT = 100

/** Something that happens once, when the pass reaches `at` (ms, at the unhurried pace). */
type Cue = { at: number; run: () => void }
/** Something drawn on each frame while the pass is between `from` and `to`, with its progress from 0 to 1. */
type Span = { from: number; to: number; run: (p: number) => void }

/**
 * Plays a pass: `length` ms at the unhurried pace, played `rate` times faster. One clock drives it, so a frame can
 * bring in as many words as the pace asks for, and a long text takes no longer than a short one.
 */
const play = (cues: Cue[], spans: Span[], length: number, rate: number, signal?: AbortSignal) =>
    new Promise<void>((res, rej) => {
        const t0 = performance.now()
        let cue = 0
        let span = 0
        const frame = (now: number) => {
            if (signal?.aborted) return res()
            try {
                // A frame's time is when the frame began, which can be just before t0.
                const t = Math.max(0, now - t0) * rate
                while (cue < cues.length && cues[cue].at <= t) cues[cue++].run()
                while (span < spans.length - 1 && spans[span].to <= t) span++
                const sp = spans[span]
                if (sp && sp.from <= t) sp.run(Math.min(1, (t - sp.from) / Math.max(1, sp.to - sp.from)))
            } catch (e) {
                return rej(e)
            }
            if ((now - t0) * rate < length) requestAnimationFrame(frame)
            else res()
        }
        requestAnimationFrame(frame)
    })

/**
 * Animates cells (title, text) from what they show now to new HTML. Resolves once they hold the new HTML; without a
 * change to show, on a hidden page, or with reduced motion, the HTML just changes.
 *
 * `fit` plays the whole animation, every stage of it, in that many ms. Aborting `signal` ends it at once, on the new HTML.
 */
export async function animateTo(cells: HTMLElement[], parts: string[], { fit, signal }: { fit?: number; signal?: AbortSignal } = {}) {
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
    try {
        // Every change, in text order, with the cell it is in.
        const changes = cells.flatMap((c, i) => {
            c.innerHTML = parts[i]
            if (!changed(diffs[i])) return []
            return stageCell(c, diffs[i]!, olds[i]).flatMap(s => (s.k === 'eq' ? [] : [{ s, cell: c }]))
        })
        const of = (k: Change['k']) => changes.filter(c => c.s.k === k)
        // The stages this change has, and how much faster they play to fit.
        const marks = of('del').length > 0 || of('chg').length > 0
        const passes = of('chg').length > 0 || of('add').length > 0
        const natural = [marks, of('del').length, of('chg').length, of('add').length].filter(Boolean).length * STAGE + (passes ? FADE + CURSOR_OUT : 0)
        const pace = fit && natural ? fit / natural : 1
        const stage = STAGE * pace
        const fade = FADE * pace
        cells.forEach(c => c.style.setProperty('--tx-fade', `${fade}ms`))
        const stopped = () => !!signal?.aborted

        // 1. The words about to go are marked: nothing moves yet.
        if (marks) await sleep(stage, signal)
        if (stopped()) return

        // 2. The removed words collapse together, with no cursor.
        const removed = of('del').flatMap(c => c.s.old)
        if (removed.length) {
            for (const u of removed) {
                const w = u.getBoundingClientRect().width
                u.animate([{ maxWidth: `${w}px`, opacity: 1 }, { maxWidth: '0px', opacity: 0 }], { duration: stage, easing: 'ease-in-out', fill: 'forwards' })
            }
            await sleep(stage, signal)
        }

        /**
         * 3 and 4. The cursor passes over these changes, each word coming in (and the word it replaces going) as the
         * cursor reaches it. A short pass keeps an unhurried pace and the cursor then rests; a long one is played as
         * much faster as it takes to fit the stage.
         */
        const pass = async (list: typeof changes) => {
            if (!list.length || stopped()) return
            const cues: Cue[] = []
            const spans: Span[] = []
            // How long a word takes to grow in or collapse, at the pace of this pass.
            let wordMs = 1
            const grow = (u: HTMLElement, cell: HTMLElement) => {
                for (let e: HTMLElement | null = u.parentElement; e; e = e.parentElement) {
                    e.classList.remove('tx-hide')
                    if (e === cell) break
                }
                u.classList.add('on')
                const w = u.getBoundingClientRect().width
                u.animate([{ maxWidth: '0px', opacity: 0 }, { maxWidth: `${w}px`, opacity: 1 }], { duration: 130 * wordMs, easing: 'ease-out' })
            }
            const shrink = (u: HTMLElement) => {
                const w = u.getBoundingClientRect().width
                u.animate([{ maxWidth: `${w}px`, opacity: 1 }, { maxWidth: '0px', opacity: 0 }], { duration: 110 * wordMs, easing: 'ease-in', fill: 'forwards' })
            }
            let t = 0
            for (const { s, cell } of list) {
                if (s.old.length) {
                    const first = s.old[0]
                    spans.push({ from: t, to: t + 90, run: () => put(edge(first, false)) })
                    t += 90
                }
                const n = Math.max(s.old.length, s.add.length)
                for (let j = 0; j < n; j++) {
                    const o = s.old[j]
                    const a = s.add[j]
                    const d = s.k === 'add' ? 36 : 42
                    cues.push({
                        at: t,
                        run: () => {
                            if (o) shrink(o)
                            if (a) grow(a, cell)
                        },
                    })
                    spans.push({ from: t, to: t + d, run: () => put(a ? edge(a, true) : edge(o, false)) })
                    t += d
                }
                t += 40
            }
            const rate = Math.max(1, t / stage)
            wordMs = 1 / rate
            await play(cues, spans, stage * rate, rate, signal)
        }
        await pass(of('chg'))
        await pass(of('add'))
        if (placed && !stopped()) {
            // The last words' colour is still fading; the cursor leaves once it has.
            await sleep(fade, signal)
            cur.style.opacity = '0'
            await sleep(CURSOR_OUT * pace, signal)
        }
    } finally {
        settle()
        cells.forEach(c => c.style.removeProperty('--tx-fade'))
        cur.remove()
    }
}
