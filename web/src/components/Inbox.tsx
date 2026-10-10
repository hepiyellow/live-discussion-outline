import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Message } from '@/types'

interface ListProps {
    heading: string
    messages: Message[]
    seen: Record<string, number>
    onReveal: (num: string) => void
}

/** A list of the agent's messages, newest first; each names its node, which it can show. */
function MessageList({ heading, messages, seen, onReveal }: ListProps) {
    return (
        <div className="max-h-[60vh] overflow-auto text-sm">
            <h4 className="px-3.5 pt-2.5 pb-1.5 text-[13px] font-semibold text-muted-foreground">{heading}</h4>
            {!messages.length && <div className="px-3.5 py-2.5 text-muted-foreground">No messages yet.</div>}
            {[...messages].reverse().map(m => (
                <div key={m.id} data-message={m.id} className={cn('border-t px-3.5 pt-2 pb-2.5', !seen[m.id] && 'shadow-[inset_3px_0_0_var(--danger)]')}>
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

/** The left pane's red envelope: the last ten messages from the agent, with the count of those not seen yet. */
export function InboxButton({ messages, seen, onSeen, onReveal }: InboxProps) {
    const [open, setOpen] = useState(false)
    if (!messages.length) return null
    const last = messages.slice(-10)
    const unseen = messages.filter(m => !seen[m.id]).length
    return (
        <Popover
            open={open}
            onOpenChange={o => {
                setOpen(o)
                if (o) onSeen(last.map(m => m.id))
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Messages from the agent"
                    title={`${messages.length} message${messages.length === 1 ? '' : 's'} from the agent${unseen ? `, ${unseen} unseen` : ''}`}
                    className="mt-auto mb-3 flex w-16 shrink-0 flex-col items-center gap-[3px] rounded-lg border pt-[7px] pb-[5px] text-[11px] text-danger hover:bg-accent"
                >
                    <Mail className="size-3.5" aria-hidden="true" />
                    {unseen > 0 && <span className="min-w-3.5 rounded-lg bg-danger px-1 text-center text-[10px] leading-3.5 text-white">{unseen}</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-[min(440px,calc(100vw-100px))] p-0">
                <MessageList
                    heading="Messages from the agent"
                    messages={last}
                    seen={seen}
                    onReveal={num => {
                        setOpen(false)
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
        <Popover
            open={open}
            onOpenChange={o => {
                setOpen(o)
                if (o) onSeen(messages.map(m => m.id))
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="msgs"
                    aria-label={`Messages about ${num}`}
                    title={`${messages.length} message${messages.length === 1 ? '' : 's'} about ${num}${fresh ? `, ${fresh} unseen` : ''}`}
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
                    onReveal={n => {
                        setOpen(false)
                        onReveal(n)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}
