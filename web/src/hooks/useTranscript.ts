import { useEffect, useState } from 'react'
import type { TranscriptEntry } from '@/types'

type ToolUse = Extract<TranscriptEntry, { type: 'tool-use' }>
type ToolResult = Extract<TranscriptEntry, { type: 'tool-result' }>

/** What the tab shows: messages, and tool calls with the result that answered them. */
export type TranscriptItem =
    | Extract<TranscriptEntry, { type: 'assistant-text' | 'user-text' }>
    | (ToolUse & { result?: ToolResult })

export interface Transcript {
    status: 'loading' | 'ready' | 'missing'
    items: TranscriptItem[]
    title: string
}

const empty: Transcript = { status: 'loading', items: [], title: '' }

/** Adds a batch of entries: a result fills in the tool call it answers, the custom title wins. */
function add(t: Transcript, entries: TranscriptEntry[], custom: { current: boolean }): Transcript {
    let items = t.items
    let title = t.title
    for (const e of entries) {
        if (e.type === 'title') {
            if (e.custom || !custom.current) title = e.title
            custom.current ||= e.custom
        } else if (e.type === 'tool-result') {
            const i = items.findIndex(x => x.type === 'tool-use' && x.id === e.toolUseId)
            if (i >= 0) items = items.map((x, j) => (j === i ? { ...(x as ToolUse), result: e } : x))
        } else items = [...items, e]
    }
    return { status: 'ready', items, title }
}

/** The linked session's transcript, followed live once `enabled` (the tab has been opened). */
export function useTranscript(session: string, enabled: boolean) {
    const [transcript, setTranscript] = useState<Transcript>(empty)
    useEffect(() => {
        if (!session || !enabled) return
        setTranscript(empty)
        const custom = { current: false }
        const es = new EventSource(`/api/transcript?id=${encodeURIComponent(session)}`)
        es.onmessage = e => setTranscript(t => add(t, JSON.parse(e.data) as TranscriptEntry[], custom))
        es.addEventListener('reset', () => {
            custom.current = false
            setTranscript(empty)
        })
        es.addEventListener('missing', () => {
            setTranscript({ ...empty, status: 'missing' })
            es.close()
        })
        return () => es.close()
    }, [session, enabled])
    return transcript
}
