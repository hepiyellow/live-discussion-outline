import { useLayoutEffect, useMemo, useRef } from 'react'
import { currentPath, startsOpen } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import { markStuck } from '@/lib/sticky'
import type { Outline, OutlineNode } from '@/types'
import { OutlineCtx, Topic, type OutlineContext } from './NodeView'

/** Which topics and parents the viewer opened or closed; the rest follow `startsOpen`. */
export type OpenNodes = Record<string, boolean>

export const isOpenIn = (open: OpenNodes) => (node: OutlineNode) => (node.num in open ? open[node.num] : startsOpen(node))

/** The Outline tab: the title, any text before the first topic, then the topics with their nodes. */
export function OutlineTab({ outline, open, onToggle }: { outline: Outline; open: OpenNodes; onToggle: (node: OutlineNode, open: boolean) => void }) {
    const root = useRef<HTMLDivElement>(null)
    const ctx = useMemo<OutlineContext>(() => {
        const isOpen = isOpenIn(open)
        return { statuses: new Statuses(outline.nodes), isOpen, toggle: node => onToggle(node, !isOpen(node)), current: currentPath(outline.nodes) }
    }, [outline, open, onToggle])

    // The header stack follows scrolling, resizing, and every change of the content.
    useLayoutEffect(() => {
        const el = root.current
        if (!el) return
        let queued = false
        const queue = () => {
            if (queued) return
            queued = true
            requestAnimationFrame(() => {
                queued = false
                markStuck(el)
            })
        }
        addEventListener('scroll', queue, { passive: true })
        addEventListener('resize', queue)
        const ro = new ResizeObserver(queue)
        ro.observe(el)
        return () => {
            removeEventListener('scroll', queue)
            removeEventListener('resize', queue)
            ro.disconnect()
        }
    }, [])
    useLayoutEffect(() => {
        if (root.current) markStuck(root.current)
    })

    return (
        <OutlineCtx.Provider value={ctx}>
            <div ref={root} className="outline-tab">
                {outline.title && <h1 className="mb-[0.85em] text-[1.85em] leading-tight font-bold tracking-tight">{outline.title}</h1>}
                {outline.intro && <div className="outline-intro" dangerouslySetInnerHTML={{ __html: outline.intro }} />}
                {outline.nodes.map(n => (
                    <Topic key={n.num} node={n} />
                ))}
            </div>
        </OutlineCtx.Provider>
    )
}
