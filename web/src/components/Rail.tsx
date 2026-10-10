import { List } from 'lucide-react'

/** The left pane: the way back to all outlines. An outline's queue and inbox are in the Outline tab's margin (QueueColumn). */
export function Rail() {
    return (
        <nav className="fixed inset-y-0 left-0 z-30 flex w-[76px] flex-col items-center overflow-y-auto border-r bg-background pt-2">
            <a href="/app/" title="All outlines" className="flex w-16 flex-col items-center gap-1 rounded-lg border py-2 text-[11px] text-foreground no-underline hover:bg-accent">
                <List className="size-7" aria-hidden="true" />
                Outlines
            </a>
        </nav>
    )
}
