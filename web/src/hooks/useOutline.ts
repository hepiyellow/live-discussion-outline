import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyPatch, emptyState } from '@/lib/viewerState'
import type { Message, Outline, OutlineList, StatePatch, TranscriptEntry, ViewerState } from '@/types'
import type { SessionFeed } from './useSession'
import { addEntries, emptyTranscript, type Transcript } from './useTranscript'

export type OutlineState = { status: 'loading' } | { status: 'ready'; outline: Outline } | { status: 'missing' } | { status: 'gone'; outline: Outline }

const apiPath = (project: string, file: string) => `${encodeURIComponent(project)}/${encodeURIComponent(file)}`

/**
 * The outline, the viewer's state of it, the outline list for the pane, and its linked session, kept up to date from
 * the outline's stream: each change of the file arrives as a new outline, each change of the state (from this window or
 * another) as a new state, each change of any outline as a new list, and the session's messages, activity and
 * transcript as they are written.
 *
 * It is the page's only stream. A browser allows six connections to one server, across all its windows, and a stream
 * holds one for as long as it is open: with a stream per kind of data, two windows used them all, and every other
 * request (a tab's script, a tick, a message) waited without end.
 */
export function useOutline(project: string, file: string) {
    const [state, setState] = useState<OutlineState>({ status: 'loading' })
    const [viewer, setViewer] = useState<ViewerState>(emptyState)
    // Until the server's state arrives, the empty one stands in; nothing may be decided from it (like what was read).
    const [stateLoaded, setStateLoaded] = useState(false)
    // Patches sent but not yet answered: laid over each state the server sends, so a late event cannot undo them.
    const pending = useRef<StatePatch[]>([])
    const server = useRef<ViewerState>(emptyState())
    const [messages, setMessages] = useState<Message[]>([])
    const [busy, setBusy] = useState(false)
    const [transcript, setTranscript] = useState<Transcript>(emptyTranscript)
    const [outlines, setOutlines] = useState<OutlineList | null>(null)
    // The transcript is long, so the stream carries it only once the Transcript tab has been opened.
    const [withTranscript, setWithTranscript] = useState(false)
    const followTranscript = useCallback(() => setWithTranscript(true), [])
    const session = useRef('')
    const shown = useRef('')

    useEffect(() => setWithTranscript(false), [project, file])

    useEffect(() => {
        // Opening the stream again for the transcript keeps what the page shows; another outline starts over.
        if (shown.current !== `${project}/${file}`) {
            shown.current = `${project}/${file}`
            session.current = ''
            setState({ status: 'loading' })
            setStateLoaded(false)
        }
        const custom = { current: false }
        const es = new EventSource(`/api/outline/${apiPath(project, file)}/events${withTranscript ? '?transcript=1' : ''}`)
        es.onmessage = e => setState({ status: 'ready', outline: JSON.parse(e.data) as Outline })
        es.addEventListener('state', e => {
            server.current = JSON.parse((e as MessageEvent).data) as ViewerState
            setViewer(pending.current.reduce(applyPatch, server.current))
            setStateLoaded(true)
        })
        es.addEventListener('outlines', e => setOutlines(JSON.parse((e as MessageEvent).data) as OutlineList))
        es.addEventListener('gone', () => setState(s => (s.status === 'ready' ? { status: 'gone', outline: s.outline } : { status: 'missing' })))
        // The linked session: named first, and again whenever what was sent about it no longer holds (the stream
        // opened again, the outline links to another session, the transcript was rewritten).
        es.addEventListener('session', e => {
            const id = JSON.parse((e as MessageEvent).data) as string
            if (id !== session.current) setBusy(false)
            session.current = id
            custom.current = false
            setMessages([])
            setTranscript(emptyTranscript)
        })
        es.addEventListener('messages', e => setMessages(m => [...m, ...(JSON.parse((e as MessageEvent).data) as Message[])]))
        es.addEventListener('activity', e => setBusy(JSON.parse((e as MessageEvent).data) === 'busy'))
        es.addEventListener('transcript', e => setTranscript(t => addEntries(t, JSON.parse((e as MessageEvent).data) as TranscriptEntry[], custom)))
        es.addEventListener('transcript-missing', () => setTranscript({ ...emptyTranscript, status: 'missing' }))
        // A stream that never opened (no such outline) is closed for good; a dropped one reconnects by itself.
        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) setState(s => (s.status === 'loading' ? { status: 'missing' } : s))
        }
        return () => es.close()
    }, [project, file, withTranscript])

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

    /** The page just sent something: the agent is working, until the transcript says the turn ended. */
    const working = useCallback(() => {
        if (session.current) setBusy(true)
    }, [])
    const feed = useMemo<SessionFeed>(() => ({ messages, busy, working }), [messages, busy, working])

    return { state, viewer, stateLoaded, patch, session: feed, transcript, followTranscript, outlines }
}
