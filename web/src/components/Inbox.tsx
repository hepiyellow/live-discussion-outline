import { useEffect, useState } from 'react'
import { Mail, MailOpen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Message } from '@/types'

interface ListProps {
    heading: string
    messages: Message[]
    seen: Record<string, number>
    /** Messages that were unread when the list opened: it is what marked them read, and they keep the unread bar while it is open. */
    fresh?: Set<string>
    onSeen: (ids: string[]) => void
    onReveal: (num: string) => void
}

/**
 * A list of the agent's messages, newest first; each names its node, which it can show. Each has an envelope on its
 * left, closed until the message is read: a click on the message or its envelope opens it, and marks it read.
 */
function MessageList({ heading, messages, seen, fresh, onSeen, onReveal }: ListProps) {
    return (
        <div className="max-h-[60vh] overflow-auto text-sm">
            <h4 className="px-3.5 pt-2.5 pb-1.5 text-[13px] font-semibold text-muted-foreground">{heading}</h4>
            {!messages.length && <div className="px-3.5 py-2.5 text-muted-foreground">No messages yet.</div>}
            {[...messages].reverse().map(m => (
                <div
                    key={m.id}
                    data-message={m.id}
                    data-read={!!seen[m.id] || undefined}
                    onClick={e => !seen[m.id] && !(e.target as Element).closest('a,button') && onSeen([m.id])}
                    className={cn('flex gap-2.5 border-t px-3.5 pt-2 pb-2.5', !seen[m.id] && 'cursor-pointer', (!seen[m.id] || fresh?.has(m.id)) && 'shadow-[inset_3px_0_0_var(--danger)]')}
                >
                    <button
                        type="button"
                        aria-label={seen[m.id] ? 'Read' : 'Unread: click to mark it read'}
                        title={seen[m.id] ? 'Read' : 'Unread: click to open it and mark it read'}
                        disabled={!!seen[m.id]}
                        onClick={() => onSeen([m.id])}
                        className={cn('mt-0.5 h-fit shrink-0 rounded p-0.5', seen[m.id] ? 'cursor-default text-muted-foreground' : 'text-foreground hover:bg-accent')}
                    >
                        {seen[m.id] ? <MailOpen className="size-4" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="flex gap-2 text-xs text-muted-foreground">
                            {m.num && (
                                <button type="button" className="text-claim hover:underline" title="Show this node" onClick={() => onReveal(m.num)}>
                                    {m.num}
                                </button>
                            )}
                            <span>{new Date(m.at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div className="message-html" dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                </div>
            ))}
        </div>
    )
}

interface InboxProps {
    messages: Message[]
    seen: Record<string, number>
    onSeen: (ids: string[]) => void
    onReveal: (num: string) => void
}

/** Where the inbox button is drawn: the queue column's footer, or the row under the input box (its popover opens upward there). */
type Placement = 'queue' | 'composer'

/**
 * The inbox envelope, under the queue or, with a session linked, under the input box's divider: the last ten messages from the agent, with the count of those not read
 * yet. Opening it reads them all, and so does a message that arrives while it is open. The ones that were unread keep
 * their red bar until it closes, so what is new can still be told apart.
 */
export function InboxButton({ messages, seen, onSeen, onReveal, placement = 'queue' }: InboxProps & { placement?: Placement }) {
    const [open, setOpen] = useState(false)
    const [fresh, setFresh] = useState<Set<string>>(new Set())
    const last = messages.slice(-10)
    // Counted among the ones the list shows, which are the ones that can be read.
    const unseenIds = last.filter(m => !seen[m.id]).map(m => m.id)
    const unseen = unseenIds.length
    const key = unseenIds.join(',')
    useEffect(() => {
        if (!open || !key) return
        const ids = key.split(',')
        setFresh(f => new Set([...f, ...ids]))
        onSeen(ids)
        // `key` says which messages are unread; onSeen is not a reason to read them again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, key])
    if (!messages.length) return null
    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next)
                if (!next) setFresh(new Set())
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Messages from the agent"
                    title={`${messages.length} message${messages.length === 1 ? '' : 's'} from the agent${unseen ? `, ${unseen} unread` : ''}`}
                    className={
                        placement === 'composer'
                            ? 'flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] text-foreground hover:bg-accent'
                            : 'flex w-16 shrink-0 flex-col items-center gap-[3px] rounded-lg border pt-[7px] pb-[5px] text-[11px] text-foreground hover:bg-accent'
                    }
                >
                    <Mail className="size-3.5" aria-hidden="true" />
                    {unseen > 0 && <span className="min-w-3.5 rounded-lg bg-danger px-1 text-center text-[10px] leading-3.5 text-white">{unseen}</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent side={placement === 'composer' ? 'top' : 'right'} align={placement === 'composer' ? 'start' : 'end'} className="w-[min(440px,calc(100vw-100px))] p-0">
                <MessageList
                    heading="Messages from the agent"
                    messages={last}
                    seen={seen}
                    fresh={fresh}
                    onSeen={onSeen}
                    onReveal={num => {
                        setOpen(false)
                        setFresh(new Set())
                        onReveal(num)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}

/** A node's own grey envelope: the messages about it or any node under it. */
export function NodeMessages({ num, messages, seen, onSeen, onReveal }: InboxProps & { num: string }) {
    const [open, setOpen] = useState(false)
    if (!messages.length) return null
    const fresh = messages.filter(m => !seen[m.id]).length
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="msgs"
                    aria-label={`Messages about ${num}`}
                    title={`${messages.length} message${messages.length === 1 ? '' : 's'} about ${num}${fresh ? `, ${fresh} unread` : ''}`}
                    onClick={e => e.stopPropagation()}
                >
                    <Mail className="size-3.5" aria-hidden="true" />
                    {fresh > 0 && <span className="n">{fresh}</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(440px,calc(100vw-100px))] p-0" onClick={e => e.stopPropagation()}>
                <MessageList
                    heading={`Messages about ${num}`}
                    messages={messages}
                    seen={seen}
                    onSeen={onSeen}
                    onReveal={n => {
                        setOpen(false)
                        onReveal(n)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}
