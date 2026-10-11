import type { Message } from '@/types'

/**
 * What the page follows of the linked session's transcript, from the outline's stream (useOutline): the agent's
 * @message notes, and whether it is in a turn. Without a linked session there is no way to see either.
 */
/** The model and effort the session's agent last answered with, from its transcript; `at` is when it answered. */
export interface Using {
    model: string
    effort: string
    at: string
}

export interface SessionFeed {
    /** What the agent last answered with; undefined until it has answered, or without a transcript. */
    using?: Using
    messages: Message[]
    busy: boolean
    /** The page just sent something: the agent is working, until the transcript says the turn ended. */
    working: () => void
}

/** Messages about a node: those naming it or any node under it. */
export const messagesAbout = (num: string, messages: Message[]) => messages.filter(m => m.num && (m.num === num || m.num.startsWith(`${num}.`)))
