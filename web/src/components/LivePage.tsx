import { useEffect, useState } from 'react'
import { api, outlineHref } from '@/lib/api'
import type { Outline, OutlineList } from '@/types'
import { Rail } from './Rail'
import { TerminalTab } from './TerminalTab'

/**
 * A session just started from "New session": its terminal, until the agent writes the outline; then the page moves to
 * the outline, on its Terminal tab.
 */
export function LivePage({ terminal }: { terminal: string }) {
    const [terminals, setTerminals] = useState<boolean | null>(null)
    useEffect(() => {
        document.title = `Starting ${terminal}`
        api<OutlineList>('/api/outlines')
            .then(l => setTerminals(l.terminals))
            .catch(() => setTerminals(false))
    }, [terminal])

    useEffect(() => {
        let stop = false
        const poll = async () => {
            try {
                const found = await api<{ project?: string; file?: string }>(`/api/outline-for?terminal=${encodeURIComponent(terminal)}`)
                if (found.project && found.file) {
                    // Open the outline where this page left off: on the Terminal tab.
                    await fetch(`/api/state/${encodeURIComponent(found.project)}/${encodeURIComponent(found.file)}`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ tab: 'term' }),
                    })
                    location.href = outlineHref(found.project, found.file)
                    return
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
        <div className="pl-[76px]">
            <Rail />
            <header data-topbar className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b bg-background px-4 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">Terminal</span>
                <span role="status">Waiting for the agent to write the outline…</span>
            </header>
            <div className="mx-auto max-w-[900px] px-5 pt-4">{terminals !== null && <TerminalTab outline={outline} active opened />}</div>
        </div>
    )
}
