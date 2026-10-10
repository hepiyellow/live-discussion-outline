import { useEffect } from 'react'
import { useOutlineList } from '@/hooks/useOutlineList'
import { OutlinesPane } from './OutlinesPane'
import { PaneToggle } from './PaneToggle'

/** All outlines: the pane on the left lists them, and the page beside it says where to start. */
export function OutlineList() {
    const list = useOutlineList()
    useEffect(() => {
        document.title = 'Outlines'
    }, [])
    return (
        <div className="pl-(--pane-w)">
            <OutlinesPane list={list} home />
            <header data-topbar className="sticky top-0 z-40 -ml-(--pane-w) flex h-11 items-center border-b bg-background px-2">
                <PaneToggle />
            </header>
            <main className="flex min-h-[calc(100vh-2.75rem)] items-center justify-center px-5 text-center text-muted-foreground">
                {list && (
                    <p data-empty-state>
                        {list.outlines.length ? 'Pick an outline on the left, or start one with New.' : 'No outlines yet. Start one with New, on the left.'}
                    </p>
                )}
            </main>
        </div>
    )
}
