import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { contentHtml } from '@/lib/content'
import { animateTo } from '@/lib/diffAnimation'
import type { HistoryEntry, OutlineNode } from '@/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Draws nodes into `root`, reusing the elements of nodes it already shows, so that the diff animation can take each
 * one from the text it shows to the new text. Returns the cells to animate, with their new HTML.
 */
function drawTree(root: HTMLElement, nodes: OutlineNode[]) {
    const shown = new Map<string, HTMLElement>()
    root.querySelectorAll<HTMLElement>('[data-hnum]').forEach(el => shown.set(el.dataset.hnum ?? '', el))
    const changes: [HTMLElement[], string[]][] = []
    const make = (n: OutlineNode): HTMLElement => {
        const text = contentHtml(n)
        let el = shown.get(n.num)
        if (el) {
            const title = el.querySelector<HTMLElement>(':scope > .hist-head > .title-html')
            const body = el.querySelector<HTMLElement>(':scope > .hist-body')
            if (title && body) changes.push([[title, body], [n.titleHtml, text]])
            shown.delete(n.num)
        } else {
            el = document.createElement('div')
            el.className = 'hist-node'
            el.dataset.hnum = n.num
            el.innerHTML = `<div class="hist-head"><span class="num">${n.num}</span><span class="title-html">${n.titleHtml}</span></div><div class="hist-body node-html">${text}</div><div class="hist-kids"></div>`
        }
        const kids = el.querySelector<HTMLElement>(':scope > .hist-kids')
        kids?.replaceChildren(...n.children.map(make))
        return el
    }
    root.replaceChildren(...nodes.map(make))
    return changes
}

/** A node's state at one entry, its children included. Switching entries animates each node from its old text to the new. */
function HistoryTree({ nodes }: { nodes: OutlineNode[] }) {
    const ref = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (!ref.current) return
        for (const [cells, parts] of drawTree(ref.current, nodes)) void animateTo(cells, parts)
    }, [nodes])
    return <div ref={ref} className="hist-tree" />
}

/**
 * The history of a node: its changes, newest first, with their times on the left; the node as it was at the chosen
 * change on the right, its children included.
 */
export function NodeHistory({ project, file, node, onClose }: { project: string; file: string; node: OutlineNode; onClose: () => void }) {
    const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
    const [picked, setPicked] = useState<number | null>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        let alive = true
        const url = `/api/outline/${encodeURIComponent(project)}/${encodeURIComponent(file)}/history?num=${encodeURIComponent(node.num)}`
        api<HistoryEntry[]>(url)
            .then(list => alive && setEntries(list))
            .catch(e => alive && setError((e as Error).message))
        return () => {
            alive = false
        }
    }, [project, file, node.num])

    const newest = (entries?.length ?? 0) - 1
    const at = picked ?? newest
    const entry = entries?.[at]
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-3">
                <DialogHeader>
                    <DialogTitle>History of {node.num}</DialogTitle>
                    <DialogDescription className="truncate">{node.title}</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 gap-4">
                    <ol className="w-52 shrink-0 space-y-0.5 overflow-y-auto border-r pr-3 text-[13px]">
                        {entries?.map((e, i) => (
                            <li key={`${e.at}-${i}`}>
                                <button
                                    type="button"
                                    onClick={() => setPicked(i)}
                                    aria-current={i === at ? 'true' : undefined}
                                    className="w-full rounded-md px-2 py-1 text-left hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-medium"
                                >
                                    {when(e.at)}
                                    {i === newest && <span className="ml-1.5 text-xs text-muted-foreground">latest</span>}
                                </button>
                            </li>
                        ))}
                    </ol>
                    <div className="min-w-0 flex-1 overflow-y-auto">
                        {!entries && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
                        {error && <p className="text-[13px] text-danger">{error}</p>}
                        {entries && !entries.length && <p className="text-[13px] text-muted-foreground">No changes recorded yet.</p>}
                        {entry && <HistoryTree nodes={[entry.node]} />}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
