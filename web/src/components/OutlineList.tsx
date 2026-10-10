import { useEffect } from 'react'
import { useOutlineList } from '@/hooks/useOutlineList'
import { OutlinesPane } from './OutlinesPane'

/** All outlines: the pane on the left lists them, and the page beside it says where to start. */
export function OutlineList() {
    const list = useOutlineList()
    useEffect(() => {
        document.title = 'Outlines'
    }, [])
    return (
        <div className="pl-(--pane-w)">
            <OutlinesPane list={list} home />
            <main className="flex min-h-screen items-center justify-center px-5 text-center text-muted-foreground">
                {list && (
                    <p data-empty-state>
                        {list.outlines.length ? 'Pick an outline on the left, or start one with New.' : 'No outlines yet. Start one with New, on the left.'}
                    </p>
                )}
            </main>
        </div>
    )
}
