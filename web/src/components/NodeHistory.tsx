import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { drawTree, transitionTree } from '@/lib/historyTree'
import type { HistoryEntry, OutlineNode } from '@/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

/** What the user did on a node, in words: an approval says what it approved. */
const didText = ({ what, kind }: NonNullable<HistoryEntry['did']>[number]) =>
    what === 'ran'
        ? 'You ran it'
        : what === 'picked'
          ? 'You picked this option'
          : what === 'took-back'
            ? kind === 'option'
                ? 'You took your pick back'
                : 'You took your approval back'
            : kind === 'claim'
              ? 'You approved this claim'
              : 'You approved this node'

const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * A node's state at one entry, its children included. Switching entries takes the tree from the one to the other, a
 * node at a time (lib/historyTree.ts); switching again meanwhile takes in the change under way at once, then starts the new one.
 */
function HistoryTree({ nodes }: { nodes: OutlineNode[] }) {
    const ref = useRef<HTMLDivElement>(null)
    const run = useRef<{ stop: AbortController; done: Promise<void>; nodes: OutlineNode[] }>(undefined)
    useLayoutEffect(() => {
        const root = ref.current
        if (!root) return
        const before = run.current
        const stop = new AbortController()
        before?.stop.abort()
        const done = (async () => {
            if (before) {
                await before.done
                drawTree(root, before.nodes)
            }
            if (!stop.signal.aborted) await transitionTree(root, nodes, stop.signal)
        })().catch(e => console.error(e))
        run.current = { stop, done, nodes }
    }, [nodes])
    useEffect(() => () => run.current?.stop.abort(), [])
    return <div ref={ref} className="hist-tree" />
}

/**
 * The history of a node: its changes, newest first, with their times on the left; the node as it was at the chosen
 * change on the right, its children included. What the user did on the node (approved it, took that back, picked it,
 * ran it) is said under the time it happened at.
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
                                    {e.did?.map((d, j) => (
                                        <span key={j} data-did={d.what} className="block text-xs font-normal text-approved">
                                            {didText(d)}
                                        </span>
                                    ))}
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
