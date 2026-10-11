import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allNodes, nodeLabel } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import type { Outline, ViewerState } from '@/types'

interface Props {
    outline: Outline
    viewer: ViewerState
    pending: string[]
    onDrop: (nums: string[]) => void
    onCopy: () => void
}

/** Without a linked session: the approvals not copied yet, each with a way to drop it, and a button to copy them all. */
export function StatusBar({ outline, viewer, pending, onDrop, onCopy }: Props) {
    if (!pending.length) return null
    const st = new Statuses(outline.nodes, viewer.overrides)
    const byNum = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
    return (
        <div role="region" aria-label="Approvals to copy" className="fixed right-0 bottom-0 left-(--pane-w) z-[15] flex flex-wrap items-center gap-1.5 border-t bg-background px-5 py-2">
            {pending.map(num => {
                const node = byNum.get(num)
                if (!node) return null
                const on = st.effective(node)
                return (
                    <span
                        key={num}
                        className={
                            on
                                ? 'inline-flex items-center gap-1 rounded-full border border-approved bg-approved py-px pr-1 pl-2.5 text-xs text-white'
                                : 'inline-flex items-center gap-1 rounded-full border border-approved py-px pr-1 pl-2.5 text-xs text-approved'
                        }
                    >
                        {(on ? (st.isOption(node) ? '◉ ' : '✓ ') : '↺ ') + nodeLabel(node)}
                        <button type="button" className="px-1 text-[13px]" title="Drop this change" aria-label={`Drop ${num}`} onClick={() => onDrop([num])}>
                            ×
                        </button>
                    </span>
                )
            })}
            <span className="flex-1" />
            <Button variant="outline" size="sm" title="Drop every queued change" onClick={() => onDrop(pending)}>
                Clear all
            </Button>
            <Button size="sm" onClick={onCopy}>
                <Copy /> Copy to clipboard
            </Button>
        </div>
    )
}
