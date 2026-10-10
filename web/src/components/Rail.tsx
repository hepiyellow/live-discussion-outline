import { List } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Statuses } from '@/lib/status'
import type { QueueItem } from '@/types'
import { DIFF_ICON, KINDS, waiting } from './queue'

interface Props {
    queue?: QueueItem[]
    statuses?: Statuses
    runs?: Record<string, number>
    onOpen?: (item: QueueItem, color: string) => void
    /** Nodes changed since the viewer read them, in outline order: listed first. */
    unread?: string[]
    onOpenUnread?: (num: string) => void
    /** At the bottom of the pane: the inbox. */
    footer?: React.ReactNode
}

/** The left pane: the way back to all outlines, then the queue, in the agent's order. */
export function Rail({ queue = [], statuses, runs = {}, onOpen, unread = [], onOpenUnread, footer }: Props) {
    const items = statuses ? waiting(queue, statuses, runs) : []
    return (
        <nav className="fixed inset-y-0 left-0 z-30 flex w-[76px] flex-col items-center overflow-y-auto border-r bg-background pt-2">
            <a href="/app/" title="All outlines" className="flex w-16 flex-col items-center gap-1 rounded-lg border py-2 text-[11px] text-foreground no-underline hover:bg-accent">
                <List className="size-7" aria-hidden="true" />
                Outlines
            </a>
            {items.length + unread.length > 0 && (
                <>
                    <hr className="mt-2.5 mb-2 w-10 border-border" />
                    <ol aria-label="Your queue" className="flex w-16 flex-col gap-1 pb-3">
                        {unread.map(num => (
                            <li key={`unread:${num}`}>
                                <button
                                    type="button"
                                    data-unread={num}
                                    title={`Changed since you read it: ${num} (shows the node; click its diff button to see the change)`}
                                    onClick={() => onOpenUnread?.(num)}
                                    className="flex w-16 items-center gap-1 rounded-md border px-[5px] py-[3px] text-[11px] leading-tight tabular-nums hover:bg-accent [&_svg]:size-3 [&_svg]:shrink-0"
                                >
                                    <span className="inline-flex text-claim">{DIFF_ICON}</span>
                                    <span className="truncate">{num}</span>
                                </button>
                            </li>
                        ))}
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
            {footer}
        </nav>
    )
}
