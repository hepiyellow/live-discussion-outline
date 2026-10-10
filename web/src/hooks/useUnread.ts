import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { contentHtml, parseVersion, readVersion, type NodeContent } from '@/lib/content'
import { animateTo } from '@/lib/diffAnimation'
import { allNodes } from '@/lib/outline'
import type { Outline, OutlineNode, StatePatch, ViewerState } from '@/types'

/**
 * Unread changes: when the agent rewrites a node the viewer has read, the page keeps showing what they read, with a
 * diff button, so the outline does not jump. Opening it animates the node to its new text. What was read is kept in
 * the viewer state; a node not read before (a new one, or every node on a first visit) shows as it is at once.
 */
export function useUnread(outline: Outline, viewer: ViewerState, stateLoaded: boolean, patch: (p: StatePatch) => Promise<void>) {
    // Topics are not tracked, as on the old page.
    const versions = useMemo(() => new Map(allNodes(outline.nodes).filter(n => n.level > 1).map(n => [n.num, readVersion(n)])), [outline])
    const [opening, setOpening] = useState<Set<string>>(new Set())
    const latest = useRef(outline)
    latest.current = outline

    // New nodes count as read; nodes no longer in the outline are forgotten.
    useEffect(() => {
        if (!stateLoaded) return
        const change: Record<string, string | null> = {}
        for (const [num, v] of versions) if (!(num in viewer.read)) change[num] = v
        for (const num of Object.keys(viewer.read)) if (!versions.has(num)) change[num] = null
        if (Object.keys(change).length) patch({ read: change })
    }, [versions, viewer.read, stateLoaded, patch])

    const unread = useMemo(() => {
        const map = new Map<string, NodeContent>()
        if (!stateLoaded) return map
        // A node being opened keeps its old HTML as far as React knows: the animation owns its DOM until it ends.
        for (const [num, v] of versions) if (num in viewer.read && viewer.read[num] !== v) map.set(num, parseVersion(viewer.read[num]))
        return map
    }, [versions, viewer.read, stateLoaded])

    const openUnread = useCallback(
        async (node: OutlineNode) => {
            const row = document.querySelector(`.outline-tab [data-num="${CSS.escape(node.num)}"]`)
            const title = row?.querySelector<HTMLElement>(':scope > .node-title > .title-html')
            const body = node.children.length ? row?.parentElement?.querySelector<HTMLElement>(':scope > .kids > .group-text') : row?.querySelector<HTMLElement>(':scope > .node-html')
            const now = allNodes(latest.current.nodes).find(n => n.num === node.num) ?? node
            setOpening(o => new Set(o).add(node.num))
            try {
                if (title && body) {
                    body.hidden = false
                    await animateTo([title, body], [now.titleHtml, contentHtml(now)])
                }
            } finally {
                await patch({ read: { [node.num]: readVersion(now) } })
                setOpening(o => {
                    const next = new Set(o)
                    next.delete(node.num)
                    return next
                })
            }
        },
        [patch],
    )

    const unreadNums = useMemo(() => [...unread.keys()].filter(n => !opening.has(n)), [unread, opening])
    return { unread, opening, openUnread, unreadNums }
}
