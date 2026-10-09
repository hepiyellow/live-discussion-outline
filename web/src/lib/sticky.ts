// Sticky, stacked headers: each topic heading and parent row sticks below the top bar and its ancestors' headers until
// its own block (the topic, or the parent with its children) has scrolled past. The page measures the real heights,
// so headers stack whatever their content makes them. These work on the DOM directly, through a ref.

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

/** How far below the window's top an element can be scrolled to without hiding under the headers above it. */
export const stackAbove = (el: Element) => barHeight() + stickyAncestors(el).reduce((n, h) => n + h.offsetHeight, 0)

/** Sets each header's place in the stack, then marks those that are stuck right now. */
export function markStuck(root: Element) {
    const bar = barHeight()
    document.documentElement.style.setProperty('--barh', `${bar}px`)
    const heads = [...root.querySelectorAll<HTMLElement>(HEAD)]
    for (const h of heads) {
        const above = stickyAncestors(h, root)
        h.style.zIndex = String(10 - above.length)
        h.style.setProperty('--top', `${bar + above.reduce((n, a) => n + a.offsetHeight, 0)}px`)
    }
    for (const h of heads) {
        const top = parseFloat(h.style.getPropertyValue('--top'))
        const stuck = h.offsetParent !== null && h.getBoundingClientRect().top <= top + 0.5 && h.parentElement!.getBoundingClientRect().bottom > top + 1
        h.toggleAttribute('data-stuck', stuck)
    }
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
        const t = reduce ? 1 : Math.min(1, (now - start) / 200)
        scrollTo(0, from + (to - from) * (1 - Math.pow(1 - t, 3)))
        if (t < 1) requestAnimationFrame(step)
        else done?.()
    }
    requestAnimationFrame(step)
}
