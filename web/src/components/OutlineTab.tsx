import { useLayoutEffect, useMemo, useRef } from 'react'
import { currentPath, startsOpen } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import { markStuck } from '@/lib/sticky'
import type { Outline, OutlineNode, ViewerState } from '@/types'
import { OutlineCtx, Topic, type OutlineContext } from './NodeView'
import { waiting } from './queue'
import { RenameTitle } from './RenameTitle'

/** Which topics and parents the viewer opened or closed; the rest follow `startsOpen`. */
export type OpenNodes = Record<string, boolean>

export const isOpenIn = (open: OpenNodes) => (node: OutlineNode) => (node.num in open ? open[node.num] : startsOpen(node))

/** The Outline tab: the title, any text before the first topic, then the topics with their nodes. */
/** The user's actions on nodes, from useApprovals. */
export type NodeActions = Pick<OutlineContext, 'linked' | 'onCheck' | 'onTopicCheck' | 'onRun' | 'onReference' | 'unread' | 'opening' | 'onOpenUnread' | 'messagesFor' | 'seen' | 'onSeen' | 'onReveal'>

interface Props {
    outline: Outline
    viewer: ViewerState
    actions: NodeActions
    onToggle: (node: OutlineNode, open: boolean) => void
}

export function OutlineTab({ outline, viewer, actions, onToggle }: Props) {
    const root = useRef<HTMLDivElement>(null)
    const ctx = useMemo<OutlineContext>(() => {
        const isOpen = isOpenIn(viewer.open)
        const statuses = new Statuses(outline.nodes, viewer.overrides)
        return {
            ...actions,
            statuses,
            // The first item about a node, as the left pane lists them.
            queued: new Map(
                waiting(outline.queue, statuses, viewer.runs)
                    .filter(q => !q.missing)
                    .reverse()
                    .map(q => [q.item.num, q.item]),
            ),
            isOpen,
            toggle: node => onToggle(node, !isOpen(node)),
            current: currentPath(outline.nodes),
            runs: viewer.runs,
        }
    }, [outline, viewer.open, viewer.overrides, viewer.runs, actions, onToggle])

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
                {outline.title && (
                    <h1 className="mb-[0.85em] text-[1.85em] leading-tight font-bold tracking-tight">
                        <RenameTitle project={outline.project} file={outline.file} title={outline.title}>
                            <span data-title>{outline.title}</span>
                        </RenameTitle>
                    </h1>
                )}
                {outline.intro && <div className="outline-intro" dangerouslySetInnerHTML={{ __html: outline.intro }} />}
                {outline.nodes.map(n => (
                    <Topic key={n.num} node={n} />
                ))}
            </div>
        </OutlineCtx.Provider>
    )
}
