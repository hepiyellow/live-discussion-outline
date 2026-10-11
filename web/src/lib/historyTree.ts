// The tree the node history shows: a node as it was at one change, its children included. Switching to another change
// takes the tree there in the diff animation's order, one node at a time, each half a second:
//   1. the nodes about to go are marked red, and the nodes whose text is about to change orange, for half a second;
//   2. the removed nodes collapse, one after another;
//   3. the changed nodes play their text's diff animation, one after another, each fitted into the half second;
//   4. the added nodes grow in, one after another.
// The pane scrolls each node to its middle before the node's turn, at no more than MAX_SCROLL.

import { contentHtml, readVersion } from '@/lib/content'
import { animateTo, sleep } from '@/lib/diffAnimation'
import type { OutlineNode } from '@/types'

/** How long each node's turn takes, and the marks before the first. */
const STAGE = 500
/** The fastest the pane scrolls to a node, in px per second. */
const MAX_SCROLL = 500

/** What each node's element shows: its title and text, as `readVersion` gives them. */
const shownAs = new WeakMap<HTMLElement, string>()

const kidsOf = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > .hist-kids')!
const cellsOf = (el: HTMLElement) => [el.querySelector<HTMLElement>(':scope > .hist-head > .title-html')!, el.querySelector<HTMLElement>(':scope > .hist-body')!]

/** The elements of the nodes `root` shows, by number, in the order they show. */
function shownIn(root: HTMLElement) {
    const shown = new Map<string, HTMLElement>()
    root.querySelectorAll<HTMLElement>('[data-hnum]').forEach(el => shown.set(el.dataset.hnum ?? '', el))
    return shown
}

/** A new element for a node, its children included. */
function create(n: OutlineNode): HTMLElement {
    const el = document.createElement('div')
    el.className = 'hist-node'
    el.dataset.hnum = n.num
    el.innerHTML = `<div class="hist-head"><span class="num">${n.num}</span><span class="title-html">${n.titleHtml}</span></div><div class="hist-body node-html">${contentHtml(n)}</div><div class="hist-kids"></div>`
    shownAs.set(el, readVersion(n))
    kidsOf(el).replaceChildren(...n.children.map(create))
    return el
}

/** Draws nodes into `root` at once, reusing the elements of nodes it already shows, and ending whatever was animating them. */
export function drawTree(root: HTMLElement, nodes: OutlineNode[]) {
    const shown = shownIn(root)
    const make = (n: OutlineNode): HTMLElement => {
        const el = shown.get(n.num)
        if (!el) return create(n)
        el.getAnimations().forEach(a => a.cancel())
        el.className = 'hist-node'
        el.removeAttribute('style')
        if (shownAs.get(el) !== readVersion(n)) {
            const [title, body] = cellsOf(el)
            title.innerHTML = n.titleHtml
            body.innerHTML = contentHtml(n)
            shownAs.set(el, readVersion(n))
        }
        kidsOf(el).replaceChildren(...n.children.map(make))
        return el
    }
    root.replaceChildren(...nodes.map(make))
}

/** The element that scrolls `el`: the nearest one above it with its own scrollbar, else the page. */
function scrollerOf(el: HTMLElement) {
    for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
    return document.scrollingElement as HTMLElement
}

/** How far `pane` has to scroll for `el` (or the `height` it is about to have) to be in its middle, as far as it can scroll. */
function offMiddle(pane: HTMLElement, el: HTMLElement, height = el.getBoundingClientRect().height) {
    const paneTop = pane === document.scrollingElement ? 0 : pane.getBoundingClientRect().top
    const wanted = pane.scrollTop + el.getBoundingClientRect().top + height / 2 - (paneTop + pane.clientHeight / 2)
    return Math.max(0, Math.min(pane.scrollHeight - pane.clientHeight, wanted)) - pane.scrollTop
}

/**
 * Scrolls `el` (or the `height` it is about to have) to the middle of what scrolls it, easing in and out, its top
 * speed MAX_SCROLL. Resolves once there, or when `signal` aborts.
 */
function scrollToMiddle(el: HTMLElement, signal: AbortSignal, height?: number) {
    const pane = scrollerOf(el)
    const from = pane.scrollTop
    const by = offMiddle(pane, el, height)
    if (Math.abs(by) < 1) return Promise.resolve()
    // Eased in and out (3p² − 2p³), the scroll is at its fastest half way: one and a half times its average speed.
    const ms = ((1.5 * Math.abs(by)) / MAX_SCROLL) * 1000
    return new Promise<void>(res => {
        const t0 = performance.now()
        const frame = (now: number) => {
            if (signal.aborted) return res()
            const p = Math.min(1, Math.max(0, now - t0) / ms)
            pane.scrollTop = from + by * p * p * (3 - 2 * p)
            if (p < 1) requestAnimationFrame(frame)
            else res()
        }
        requestAnimationFrame(frame)
    })
}

/**
 * Keeps `el` in the middle of what scrolls it while it changes size, moving no faster than MAX_SCROLL. Returns what
 * ends it.
 */
function follow(el: HTMLElement, signal: AbortSignal) {
    const pane = scrollerOf(el)
    let on = true
    let at = performance.now()
    const frame = (now: number) => {
        if (!on || signal.aborted || !el.isConnected) return
        const most = (MAX_SCROLL * Math.max(0, now - at)) / 1000
        at = now
        const by = offMiddle(pane, el)
        if (Math.abs(by) >= 1) pane.scrollTop += Math.max(-most, Math.min(most, by))
        requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    return () => {
        on = false
    }
}

/** Resolves once `animation` has ended; aborting `signal` ends it at once. */
async function ended(animation: Animation, signal: AbortSignal) {
    signal.addEventListener('abort', () => animation.cancel(), { once: true })
    await animation.finished.catch(() => {})
}

/**
 * Takes the tree `root` shows to `nodes`, in the order above. Without a tree to start from, on a hidden page, or with
 * reduced motion, the tree just changes. Aborting `signal` stops it where it is: `drawTree` then puts a tree in place.
 */
export async function transitionTree(root: HTMLElement, nodes: OutlineNode[], signal: AbortSignal) {
    const shown = shownIn(root)
    if (!shown.size || document.visibilityState !== 'visible' || matchMedia('(prefers-reduced-motion: reduce)').matches) return drawTree(root, nodes)

    const next = new Map<string, OutlineNode>()
    // The new nodes, each with the number of the node it is under and the nodes beside it. A new node brings its children.
    const added: { node: OutlineNode; under: string | null; beside: OutlineNode[] }[] = []
    const index = (list: OutlineNode[], under: string | null) =>
        list.forEach(n => {
            next.set(n.num, n)
            if (shown.has(n.num)) index(n.children, n.num)
            else added.push({ node: n, under, beside: list })
        })
    index(nodes, null)
    // A removed node takes its children with it.
    const removed = [...shown]
        .filter(([num, el]) => {
            const above = el.parentElement?.closest<HTMLElement>('[data-hnum]')
            return !next.has(num) && (!above || next.has(above.dataset.hnum ?? ''))
        })
        .map(([, el]) => el)
    const changed = [...next.values()].flatMap(n => {
        const el = shown.get(n.num)
        return el && shownAs.get(el) !== readVersion(n) ? [{ el, node: n }] : []
    })
    const stopped = () => signal.aborted
    // The browser's own scroll anchoring would move the pane as nodes change size: the pane is scrolled from here alone.
    const pane = scrollerOf(root)
    const anchoring = pane.style.overflowAnchor
    pane.style.overflowAnchor = 'none'
    try {
        await stages()
    } finally {
        pane.style.overflowAnchor = anchoring
    }

    async function stages() {
        // 1. The marks, with the first marked node in view.
        const marked = [...removed, ...changed.map(c => c.el)]
        removed.forEach(el => el.classList.add('hist-del'))
        changed.forEach(({ el }) => el.classList.add('hist-chg'))
        if (marked.length) {
            await scrollToMiddle(removed[0] ?? marked[0], signal)
            await sleep(STAGE, signal)
        }

        // 2. The removed nodes collapse.
        for (const el of removed) {
            if (stopped()) return
            await scrollToMiddle(el, signal)
            if (stopped()) return
            el.style.overflow = 'clip'
            const unfollow = follow(el, signal)
            await ended(
                el.animate(
                    [
                        { height: `${el.offsetHeight}px`, opacity: 1 },
                        { height: '0px', marginTop: '0px', opacity: 0 },
                    ],
                    { duration: STAGE, easing: 'ease-in-out', fill: 'forwards' },
                ),
                signal,
            )
            unfollow()
            if (stopped()) return
            el.remove()
        }

        // 3. The changed nodes take their new text.
        for (const { el, node } of changed) {
            if (stopped()) return
            await scrollToMiddle(el, signal)
            if (stopped()) return
            el.classList.remove('hist-chg')
            const unfollow = follow(el, signal)
            await animateTo(cellsOf(el), [node.titleHtml, contentHtml(node)], { fit: STAGE, signal })
            unfollow()
            shownAs.set(el, readVersion(node))
        }

        // 4. The added nodes grow in, each before the first node after it that is already there.
        for (const { node, under, beside } of added) {
            if (stopped()) return
            const into = under === null ? root : kidsOf(shownIn(root).get(under)!)
            const after = beside.slice(beside.indexOf(node) + 1).map(n => shownIn(root).get(n.num))
            const el = create(node)
            into.insertBefore(el, after.find(e => e?.parentElement === into) ?? null)
            const height = el.offsetHeight
            const margin = getComputedStyle(el).marginTop
            Object.assign(el.style, { overflow: 'clip', height: '0px', marginTop: '0px', opacity: '0' })
            await scrollToMiddle(el, signal, height)
            if (stopped()) return
            el.classList.add('hist-add')
            const grown = el.animate(
                [
                    { height: '0px', marginTop: '0px', opacity: 0 },
                    { height: `${height}px`, marginTop: margin, opacity: 1 },
                ],
                { duration: STAGE, easing: 'ease-in-out' },
            )
            el.removeAttribute('style')
            el.style.overflow = 'clip'
            const unfollow = follow(el, signal)
            await ended(grown, signal)
            unfollow()
            el.style.overflow = ''
        }
        // Whatever moved without changing is put where it belongs.
        if (!stopped()) drawTree(root, nodes)
    }
}
