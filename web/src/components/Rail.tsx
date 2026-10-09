import { CircleCheck, CircleHelp, Eye, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allNodes } from '@/lib/outline'
import type { Statuses } from '@/lib/status'
import type { QueueItem } from '@/types'

const KINDS: Record<QueueItem['kind'], { name: string; color: string; icon: React.ReactNode }> = {
    decide: { name: 'Decide', color: 'var(--danger)', icon: <CircleHelp aria-hidden="true" /> },
    approve: { name: 'Approve', color: 'var(--claim)', icon: <CircleCheck aria-hidden="true" /> },
    action: {
        name: 'Run',
        color: 'var(--danger)',
        icon: (
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
            </svg>
        ),
    },
    read: { name: 'Read', color: 'var(--foreground)', icon: <Eye aria-hidden="true" /> },
}

/**
 * Whether the user has handled a queue item on the page: an action once run, anything else once it (or every node
 * under it) is approved or picked. The agent drops it from the file later.
 */
function handled(item: QueueItem, statuses: Statuses, runs: Record<string, number>) {
    const node = allNodes(statuses.nodes).find(n => n.num === item.num)
    if (!node) return { missing: true, done: false }
    if (item.kind === 'action' && node.level > 1) return { missing: false, done: !node.tags.includes('action') || node.tags.includes('ran') || !!runs[node.num] }
    const kinds = node.level === 1 ? node.children.flatMap(c => statuses.kindsOf(c)) : statuses.kindsOf(node)
    return { missing: false, done: kinds.length > 0 && kinds.every(k => k === 'approved' || k === 'pending') }
}

interface Props {
    queue?: QueueItem[]
    statuses?: Statuses
    runs?: Record<string, number>
    onOpen?: (item: QueueItem, color: string) => void
}

/** The left pane: the way back to all outlines, then the queue, in the agent's order. */
export function Rail({ queue = [], statuses, runs = {}, onOpen }: Props) {
    const items = statuses ? queue.map(item => ({ item, ...handled(item, statuses, runs) })).filter(q => !q.done) : []
    return (
        <nav className="fixed inset-y-0 left-0 z-30 flex w-[76px] flex-col items-center overflow-y-auto border-r bg-background pt-2">
            <a href="/" title="All outlines" className="flex w-16 flex-col items-center gap-1 rounded-lg border py-2 text-[11px] text-foreground no-underline hover:bg-accent">
                <List className="size-7" aria-hidden="true" />
                Outlines
            </a>
            {items.length > 0 && (
                <>
                    <hr className="mt-2.5 mb-2 w-10 border-border" />
                    <ol aria-label="Your queue" className="flex w-16 flex-col gap-1 pb-3">
                        {items.map(({ item, missing }) => {
                            const kind = KINDS[item.kind]
                            return (
                                <li key={`${item.kind}:${item.num}`}>
                                    <button
                                        type="button"
                                        data-queue={item.num}
                                        data-kind={item.kind}
                                        title={`${kind.name} ${item.num}: ${item.label}${missing ? ' (not in the outline)' : ''}`}
                                        onClick={() => onOpen?.(item, kind.color)}
                                        className={cn(
                                            'flex w-16 items-center gap-1 rounded-md border px-[5px] py-[3px] text-[11px] leading-tight tabular-nums hover:bg-accent [&_svg]:size-3 [&_svg]:shrink-0',
                                            missing && 'opacity-50',
                                        )}
                                    >
                                        <span style={{ color: kind.color }} className="inline-flex">
                                            {kind.icon}
                                        </span>
                                        <span className="truncate">{item.num}</span>
                                    </button>
                                </li>
                            )
                        })}
                    </ol>
                </>
            )}
        </nav>
    )
}
