import { useCallback, useEffect, useState } from 'react'
import type { Message } from '@/types'

/**
 * What the page follows of the linked session's transcript (by its `Session:` id): the agent's @message notes, and
 * whether it is in a turn. Without a session id there is no way to see either.
 */
export function useSession(session: string) {
    const [messages, setMessages] = useState<Message[]>([])
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setMessages([])
        if (!session) return
        const es = new EventSource(`/messages?id=${encodeURIComponent(session)}`)
        es.onmessage = e => setMessages(m => [...m, ...(JSON.parse(e.data) as Message[])])
        es.addEventListener('reset', () => setMessages([]))
        return () => es.close()
    }, [session])

    useEffect(() => {
        setBusy(false)
        if (!session) return
        const es = new EventSource(`/activity?id=${encodeURIComponent(session)}`)
        es.addEventListener('state', e => setBusy((e as MessageEvent).data === 'busy'))
        return () => es.close()
    }, [session])

    /** The page just sent something: the agent is working, until the transcript says the turn ended. */
    const working = useCallback(() => {
        if (session) setBusy(true)
    }, [session])

    return { messages, busy, working }
}

/** Messages about a node: those naming it or any node under it. */
export const messagesAbout = (num: string, messages: Message[]) => messages.filter(m => m.num && (m.num === num || m.num.startsWith(`${num}.`)))
