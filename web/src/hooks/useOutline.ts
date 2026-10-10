import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPatch, emptyState } from '@/lib/viewerState'
import type { Outline, StatePatch, ViewerState } from '@/types'

export type OutlineState = { status: 'loading' } | { status: 'ready'; outline: Outline } | { status: 'missing' } | { status: 'gone'; outline: Outline }

const apiPath = (project: string, file: string) => `${encodeURIComponent(project)}/${encodeURIComponent(file)}`

/**
 * The outline and the viewer's state of it, kept up to date from the outline's stream: each change of the file arrives
 * as a new outline, each change of the state (from this window or another) as a new state.
 */
export function useOutline(project: string, file: string) {
    const [state, setState] = useState<OutlineState>({ status: 'loading' })
    const [viewer, setViewer] = useState<ViewerState>(emptyState)
    // Until the server's state arrives, the empty one stands in; nothing may be decided from it (like what was read).
    const [stateLoaded, setStateLoaded] = useState(false)
    // Patches sent but not yet answered: laid over each state the server sends, so a late event cannot undo them.
    const pending = useRef<StatePatch[]>([])
    const server = useRef<ViewerState>(emptyState())

    useEffect(() => {
        setState({ status: 'loading' })
        setStateLoaded(false)
        const es = new EventSource(`/api/outline/${apiPath(project, file)}/events`)
        es.onmessage = e => setState({ status: 'ready', outline: JSON.parse(e.data) as Outline })
        es.addEventListener('state', e => {
            server.current = JSON.parse((e as MessageEvent).data) as ViewerState
            setViewer(pending.current.reduce(applyPatch, server.current))
            setStateLoaded(true)
        })
        es.addEventListener('gone', () => setState(s => (s.status === 'ready' ? { status: 'gone', outline: s.outline } : { status: 'missing' })))
        // A stream that never opened (no such outline) is closed for good; a dropped one reconnects by itself.
        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) setState(s => (s.status === 'loading' ? { status: 'missing' } : s))
        }
        return () => es.close()
    }, [project, file])

    /** Changes the viewer state here at once, and on the server. */
    const patch = useCallback(
        async (change: StatePatch) => {
            pending.current.push(change)
            setViewer(v => applyPatch(v, change))
            try {
                const res = await fetch(`/api/state/${apiPath(project, file)}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(change),
                })
                if (res.ok) server.current = (await res.json()) as ViewerState
                else console.error(`state not saved: ${await res.text()}`)
            } catch (e) {
                console.error('state not saved', e)
            } finally {
                pending.current = pending.current.filter(p => p !== change)
                setViewer(pending.current.reduce(applyPatch, server.current))
            }
        },
        [project, file],
    )

    return { state, viewer, stateLoaded, patch }
}
