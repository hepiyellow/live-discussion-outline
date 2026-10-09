import { useEffect, useState } from 'react'
import type { Outline } from '@/types'

export type OutlineState = { status: 'loading' } | { status: 'ready'; outline: Outline } | { status: 'missing' } | { status: 'gone'; outline: Outline }

/** The outline, kept up to date from its stream: each change of the file arrives as a new payload. */
export function useOutline(project: string, file: string): OutlineState {
    const [state, setState] = useState<OutlineState>({ status: 'loading' })
    useEffect(() => {
        setState({ status: 'loading' })
        const es = new EventSource(`/api/outline/${encodeURIComponent(project)}/${encodeURIComponent(file)}/events`)
        es.onmessage = e => setState({ status: 'ready', outline: JSON.parse(e.data) as Outline })
        es.addEventListener('gone', () => setState(s => (s.status === 'ready' ? { status: 'gone', outline: s.outline } : { status: 'missing' })))
        // A stream that never opened (no such outline) is closed for good; a dropped one reconnects by itself.
        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) setState(s => (s.status === 'loading' ? { status: 'missing' } : s))
        }
        return () => es.close()
    }, [project, file])
    return state
}
