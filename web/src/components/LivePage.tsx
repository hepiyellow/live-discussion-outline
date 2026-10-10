import { useEffect } from 'react'
import { useOutlineList } from '@/hooks/useOutlineList'
import { api, outlineHref } from '@/lib/api'
import type { Outline } from '@/types'
import { OutlinesPane } from './OutlinesPane'
import { TerminalTab } from './TerminalTab'

/**
 * A session just started from "New session": its session terminal fills the main area while the agent works. Once the
 * outline's first version is written (it has a node), the page opens that outline.
 */
export function LivePage({ terminal }: { terminal: string }) {
    // The list for the pane; it also says whether terminals can be shown.
    const list = useOutlineList()
    const terminals = list ? list.terminals : null
    useEffect(() => {
        document.title = `Starting ${terminal}`
    }, [terminal])

    useEffect(() => {
        let stop = false
        const poll = async () => {
            try {
                const found = await api<{ project?: string; file?: string }>(`/api/outline-for?terminal=${encodeURIComponent(terminal)}`)
                if (found.project && found.file) {
                    const outline = await api<Outline>(`/api/outline/${encodeURIComponent(found.project)}/${encodeURIComponent(found.file)}`)
                    // Headers alone are not the first version: stay on the terminal until a node is there.
                    if (outline.nodes.length) {
                        await fetch(`/api/state/${encodeURIComponent(found.project)}/${encodeURIComponent(found.file)}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ tab: 'outline' }),
                        })
                        location.href = outlineHref(found.project, found.file)
                        return
                    }
                }
            } catch {}
            if (!stop) setTimeout(poll, 2000)
        }
        poll()
        return () => {
            stop = true
        }
    }, [terminal])

    // The Terminal tab only needs to know the session and whether terminals can be shown.
    const outline = { terminal, terminalTab: !!terminals } as Outline
    return (
        <div className="pl-(--pane-w)">
            <OutlinesPane list={list} starting={terminal} />
            <header data-topbar className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b bg-background px-4 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">Terminal</span>
                <span role="status">Waiting for the agent to write the outline…</span>
            </header>
            <div className="mx-auto max-w-[900px] px-5 pt-4">{terminals !== null && <TerminalTab outline={outline} active opened />}</div>
        </div>
    )
}
