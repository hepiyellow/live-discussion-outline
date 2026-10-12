import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { contentHtml, isRead, parseVersion, readVersion, wording, type NodeContent } from '@/lib/content'
import { animateTo } from '@/lib/diffAnimation'
import { allNodes } from '@/lib/outline'
import type { PendingChange } from '@/lib/pending'
import type { Outline, OutlineNode, StatePatch, ViewerState } from '@/types'

/**
 * Pending changes: what the agent changed in the outline since the viewer read it waits until they open it, so the
 * outline does not change under them. What they read of each node (its title, text and kind) is kept in the viewer
 * state, topics included.
 *
 * - A node that reads differently from what they read is `changed`: the page keeps showing what they read, with a
 *   diff button. Opening it animates the node to its new text.
 * - A node they have not read is `added`: it is there as a bare row, with a plus, and everything under it comes with
 *   it when it is opened.
 *
 * What is not a change: every node on a first visit, a node that only changed its number (the agent renumbers the
 * nodes after a removed one), and the user's own approval or pick, which applies at once.
 */
export function useUnread(outline: Outline, viewer: ViewerState, stateLoaded: boolean, patch: (p: StatePatch) => Promise<void>) {
    const nodes = useMemo(() => allNodes(outline.nodes), [outline])
    const byNum = useMemo(() => new Map(nodes.map(n => [n.num, n])), [nodes])
    const [opening, setOpening] = useState<Set<string>>(new Set())
    const latest = useRef(outline)
    latest.current = outline

    /**
     * The changes that wait, in outline order, and what counts as read without asking (`settle`): a node number with
     * the version to keep for it, or null for a number the outline no longer has.
     */
    const { pending, settle } = useMemo(() => {
        const pending = new Map<string, PendingChange>()
        const settle: Record<string, string | null> = {}
        if (!stateLoaded) return { pending, settle }
        const read = viewer.read
        const first = !Object.keys(read).length
        // A viewer state from before topics were tracked has none of them: they are there, not new.
        const topicsTracked = Object.keys(read).some(num => !num.includes('.'))
        // What the viewer read under a number that no longer reads so: a node that reads like one of these only changed
        // its number, which is not a change to open.
        const movedFrom = new Map<string, string[]>()
        for (const [num, version] of Object.entries(read)) {
            if (byNum.has(num) && isRead(version, byNum.get(num)!)) continue
            movedFrom.set(wording(version), [...(movedFrom.get(wording(version)) ?? []), num])
        }
        // Read under another number: a node whose kind alone changed reads like its own entry, and that is a change.
        const moved = (node: OutlineNode, version: string) => (movedFrom.get(wording(version)) ?? []).some(num => num !== node.num)
        const added: string[] = []
        for (const node of nodes) {
            const version = readVersion(node)
            const was = read[node.num]
            // Inside a node that is new to the viewer: it comes with that node.
            if (added.some(num => node.num.startsWith(`${num}.`))) continue
            if (was !== undefined && isRead(was, node)) {
                if (was !== version) settle[node.num] = version
            } else if (first || moved(node, version) || (was === undefined && node.level === 1 && !topicsTracked)) settle[node.num] = version
            else if (was === undefined) {
                added.push(node.num)
                pending.set(node.num, { kind: 'added' })
            } else pending.set(node.num, { kind: 'changed', was: parseVersion(was), done: node.tags.includes('ran') })
        }
        for (const num of Object.keys(read)) if (!byNum.has(num)) settle[num] = null
        return { pending, settle }
    }, [nodes, byNum, viewer.read, stateLoaded])

    useEffect(() => {
        if (Object.keys(settle).length) patch({ read: settle })
    }, [settle, patch])

    /** Changed nodes as the viewer read them. A node being opened keeps its old HTML as far as React knows: the animation owns its DOM until it ends. */
    const unread = useMemo(() => {
        const map = new Map<string, NodeContent>()
        for (const [num, change] of pending) if (change.kind === 'changed' && change.was) map.set(num, change.was)
        return map
    }, [pending])

    /** The changes that still wait: those being opened count as opened from the moment the animation starts. */
    const waiting = useMemo(() => new Map([...pending].filter(([num]) => !opening.has(num))), [pending, opening])
    const unreadNums = useMemo(() => [...waiting.keys()], [waiting])

    const now = (num: string) => allNodes(latest.current.nodes).find(n => n.num === num)

    /** Opens the change of one changed node: animates it to its new title and text. */
    const openUnread = useCallback(
        async (node: OutlineNode) => {
            const row = document.querySelector(`.outline-tab [data-num="${CSS.escape(node.num)}"]`)
            const title = row?.querySelector<HTMLElement>(':scope > .node-title > .title-html')
            const body =
                node.level === 1
                    ? row?.parentElement?.querySelector<HTMLElement>(':scope > .topic-body > .topic-text')
                    : node.children.length
                      ? row?.parentElement?.querySelector<HTMLElement>(':scope > .kids > .group-text')
                      : row?.querySelector<HTMLElement>(':scope > .node-html')
            const live = now(node.num) ?? node
            setOpening(o => new Set(o).add(node.num))
            // A collapsed node (an approved or done one starts so) is shown by the diff; its open state follows, or the
            // triangle would say closed over the text and the next click on the row would only open it.
            if (body?.hidden || body?.closest('[hidden]')) patch({ open: { [node.num]: true } })
            try {
                if (title && body) {
                    body.hidden = false
                    await animateTo([title, body], [live.titleHtml, contentHtml(live)])
                }
            } finally {
                await patch({ read: { [node.num]: readVersion(live) } })
                setOpening(o => {
                    const next = new Set(o)
                    next.delete(node.num)
                    return next
                })
            }
        },
        [patch],
    )

    /** The nodes under `num` (not `num` itself) with a change to open, in outline order. */
    const unreadUnder = useCallback((num: string) => unreadNums.filter(n => n.startsWith(`${num}.`)), [unreadNums])

    /** What a node and everything under it reads as now: what opening an added node records. */
    const versionsUnder = (num: string) => Object.fromEntries(allNodes(now(num) ? [now(num)!] : []).map(n => [n.num, readVersion(n)]))

    /**
     * Opens every change under a node. The node stays where it is on the screen: the browser's own scroll anchoring is
     * switched off meanwhile (it would keep some other element still, and move this one), and the node's offset from the
     * top of the window is held while its descendants change size. Changes in view play their animation, together; the
     * rest (collapsed, off screen, or added nodes) are taken in at once.
     */
    const openUnreadUnder = useCallback(
        async (node: OutlineNode) => {
            const nums = unreadUnder(node.num)
            if (!nums.length) return
            const anchor = document.querySelector<HTMLElement>(`.outline-tab [data-num="${CSS.escape(node.num)}"]`)
            const top = anchor?.getBoundingClientRect().top ?? 0
            const root = document.documentElement
            const anchoring = root.style.overflowAnchor
            root.style.overflowAnchor = 'none'
            let holding = true
            const hold = () => {
                if (!holding) return
                const delta = (anchor?.getBoundingClientRect().top ?? top) - top
                if (Math.abs(delta) > 0.5) scrollBy(0, delta)
                requestAnimationFrame(hold)
            }
            requestAnimationFrame(hold)
            try {
                const inView = (num: string) => {
                    const body = document.querySelector(`.outline-tab [data-num="${CSS.escape(num)}"]`)
                    const r = body?.getBoundingClientRect()
                    return !!r && r.height > 0 && r.bottom > 0 && r.top < innerHeight
                }
                const animated = nums.filter(n => pending.get(n)?.kind === 'changed' && inView(n))
                const rest = nums.filter(n => !animated.includes(n))
                const quiet = Object.assign({}, ...rest.map(n => (pending.get(n)?.kind === 'added' ? versionsUnder(n) : now(n) ? { [n]: readVersion(now(n)!) } : {})))
                const shown = animated.flatMap(n => (now(n) ? [now(n)!] : []))
                await Promise.all([Object.keys(quiet).length ? patch({ read: quiet }) : Promise.resolve(), ...shown.map(n => openUnread(n))])
            } finally {
                // One more frame, so the last change has been laid out before the hold ends.
                await new Promise(r => requestAnimationFrame(() => r(null)))
                holding = false
                root.style.overflowAnchor = anchoring
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [unreadUnder, openUnread, patch, pending],
    )

    /**
     * A click on a node's diff button: opens the node's own change and every change under it. An added node comes with
     * everything under it, and opens: what is new is what there is to read.
     */
    const openChange = useCallback(
        async (node: OutlineNode) => {
            const own = waiting.get(node.num)
            if (own?.kind === 'added') return patch({ read: versionsUnder(node.num), open: { [node.num]: true } })
            await Promise.all([own ? openUnread(node) : Promise.resolve(), openUnreadUnder(node)])
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [waiting, openUnread, openUnreadUnder, patch],
    )

    return { pending: waiting, unread, opening, openUnread, openChange, unreadNums, unreadUnder, openUnreadUnder }
}
