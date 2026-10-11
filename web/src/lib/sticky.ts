// Sticky, stacked headers: each topic heading and parent row sticks below the top bar and its ancestors' headers until
// its own block (the topic, or the parent with its children) has scrolled past. A stuck header is one row high
// (--rh in outline.css), whatever its own height, so the stack is a row per header. These work on the DOM directly,
// through a ref.

const HEAD = '[data-sticky]'
const BLOCK = '.topic, .group'

/** The sticky headers above an element: those of the topics and parents it sits in (not its own). */
export function stickyAncestors(el: Element, root?: Element | null): HTMLElement[] {
    const out: HTMLElement[] = []
    const start = el.matches(HEAD) ? el.parentElement?.parentElement : el.parentElement
    for (let e = start ?? null; e && e !== root; e = e.parentElement)
        if (e.matches(BLOCK)) {
            const head = e.firstElementChild
            if (head instanceof HTMLElement && head.matches(HEAD)) out.push(head)
        }
    return out
}

const barHeight = () => document.querySelector<HTMLElement>('[data-topbar]')?.offsetHeight ?? 0

/** The height of a stuck header: one row. */
const rowHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rh')) || 32

/**
 * How far below the window's top an element can be scrolled to without hiding under the headers above it: they are
 * stuck once it is there, a row each.
 */
export const stackAbove = (el: Element) => barHeight() + stickyAncestors(el).length * rowHeight()

/** Sets a custom property only when it changes, so an unchanged header costs no new layout. */
const setVar = (el: HTMLElement, name: string, value: string) => {
    if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
}

/**
 * Sets each header's place in the stack, then marks those that are stuck right now.
 *
 * A stuck header is cut to one row, which is not its own height (a parent row is taller, a wrapped title much taller).
 * Were that to move the page, the answer would change the question: near the end of a block the shorter header pulls
 * the block's bottom above the line that makes it stuck, so it is no longer stuck, grows back, and is stuck again,
 * every frame, and everything below jumps by the difference. So nothing here depends on what is stuck: every header is
 * measured at its own height, a header above counts as one row (which it is whenever one under it can stick), and a
 * stuck header keeps the room of its own height (`--own-h`, a margin below it in outline.css), so nothing below it
 * moves when it sticks.
 */
export function markStuck(root: Element) {
    const bar = barHeight()
    const row = rowHeight()
    document.documentElement.style.setProperty('--barh', `${bar}px`)
    const heads = [...root.querySelectorAll<HTMLElement>(HEAD)]
    const tops = heads.map(h => {
        const depth = stickyAncestors(h, root).length
        h.style.zIndex = String(10 - depth)
        setVar(h, '--top', `${bar + depth * row}px`)
        h.removeAttribute('data-stuck')
        return bar + depth * row
    })
    // One layout, with every header at its own height: to the fraction of a pixel, which a line of text can have.
    const now = heads.map((h, i) => {
        const rect = h.getBoundingClientRect()
        return { own: rect.height, stuck: h.offsetParent !== null && rect.top <= tops[i] + 0.5 && h.parentElement!.getBoundingClientRect().bottom > tops[i] + 1 }
    })
    heads.forEach((h, i) => {
        setVar(h, '--own-h', `${now[i].own}px`)
        h.toggleAttribute('data-stuck', now[i].stuck)
    })
}

/** A spacer under the page lets an item near the end scroll up to the top. */
function makeRoom(want: number) {
    const short = () => want - (document.documentElement.scrollHeight - innerHeight)
    if (short() <= 0) return
    let spacer = document.getElementById('scroll-room')
    if (!spacer) {
        spacer = document.createElement('div')
        spacer.id = 'scroll-room'
        document.body.appendChild(spacer)
    }
    // A page shorter than the window reports the window's height, so one step may not be enough.
    for (let i = 0; i < 3 && short() > 0.5; i++) spacer.style.height = `${spacer.offsetHeight + short()}px`
}

/** Scrolls an element to just below the headers above it, over 200 ms (ease-out), then calls `done`. */
export function scrollToNode(el: Element, done?: () => void) {
    const from = scrollY
    const want = Math.max(0, from + el.getBoundingClientRect().top - stackAbove(el) - 4)
    makeRoom(want)
    const to = Math.min(want, document.documentElement.scrollHeight - innerHeight)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const step = (now: number) => {
        const t = reduce ? 1 : Math.max(0, Math.min(1, (now - start) / 200))
        scrollTo(0, from + (to - from) * (1 - Math.pow(1 - t, 3)))
        if (t < 1) requestAnimationFrame(step)
        else done?.()
    }
    requestAnimationFrame(step)
}

/**
 * Collapses a completed node over half a second while the page scrolls it to the top, just below the headers above
 * it; `done` then closes it for real. Nothing animates on a hidden page or when the system asks for reduced motion.
 */
export function collapseAnimated(num: string, done: () => void) {
    const head = document.querySelector<HTMLElement>(`.outline-tab [data-num="${CSS.escape(num)}"]`)
    const block = head?.parentElement
    const body = block?.children[1]
    if (!head || !block || !(body instanceof HTMLElement) || document.visibilityState !== 'visible' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        done()
        return
    }
    // A header that is stuck reports where it sticks, so measure its block.
    const from = scrollY
    const h0 = body.offsetHeight
    const want = Math.max(0, block.getBoundingClientRect().top + from - stackAbove(head) - 4)
    // Once its children are gone the page is h0 shorter, and a node near the end must still reach the top.
    makeRoom(want + h0)
    body.style.overflow = 'hidden'
    body.style.height = `${h0}px`
    const start = performance.now()
    const step = (now: number) => {
        const t = Math.max(0, Math.min(1, (now - start) / 500))
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        body.style.height = `${h0 * (1 - e)}px`
        scrollTo(0, from + (want - from) * e)
        if (t < 1) return requestAnimationFrame(step)
        done()
        // The node is closed by the next render; until then it stays at no height.
        setTimeout(() => {
            body.style.height = ''
            body.style.overflow = ''
            scrollTo(0, want)
        }, 50)
    }
    requestAnimationFrame(step)
}
