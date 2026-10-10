import { useLayoutEffect, useRef } from 'react'
import { useTranscript, type TranscriptItem } from '@/hooks/useTranscript'
import { cn } from '@/lib/utils'
import type { Outline } from '@/types'

function Item({ item }: { item: TranscriptItem }) {
    switch (item.type) {
        case 'assistant-text':
            return <div className="transcript-assistant my-2.5" dangerouslySetInnerHTML={{ __html: item.html }} />
        case 'user-text':
            return item.system ? (
                <div className="my-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{item.text}</div>
            ) : (
                <div className="my-2.5 rounded-[10px] bg-claim/10 px-3 py-2 whitespace-pre-wrap" data-entry="user">
                    {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
                    {item.text}
                </div>
            )
        case 'tool-use':
            // A tool call is collapsed: its name and summary, then its input and result when opened.
            return (
                <details className="transcript-tool my-px text-[13px] text-muted-foreground" data-tool={item.id}>
                    <summary className="cursor-pointer truncate rounded-md px-1.5 py-px hover:bg-accent">
                        <span className="font-semibold text-foreground">{item.name}</span> {item.summary}
                    </summary>
                    <pre className="mt-1 mb-1.5 ml-7 max-h-80 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5 text-xs break-words whitespace-pre-wrap">{item.input}</pre>
                    {item.result && (
                        <pre
                            data-result={item.result.error ? 'error' : 'ok'}
                            className={cn('mt-1 mb-1.5 ml-7 max-h-80 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5 text-xs break-words whitespace-pre-wrap', item.result.error && 'text-danger')}
                        >
                            {item.result.text}
                        </pre>
                    )}
                </details>
            )
    }
}

const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 80

/**
 * The Transcript tab: the linked session's messages and tool calls, followed live. It keeps to the bottom while the
 * viewer is there, and opens at the bottom.
 */
export function TranscriptTab({ outline, active, opened }: { outline: Outline; active: boolean; opened: boolean }) {
    const transcript = useTranscript(outline.session, opened)
    const stick = useRef(true)
    const shownBefore = useRef(false)
    useLayoutEffect(() => {
        if (active && (stick.current || !shownBefore.current)) scrollTo(0, document.documentElement.scrollHeight)
        shownBefore.current = active && transcript.items.length > 0
    }, [transcript.items, active])
    useLayoutEffect(() => {
        if (!active) return
        const onScroll = () => (stick.current = atBottom())
        addEventListener('scroll', onScroll, { passive: true })
        return () => removeEventListener('scroll', onScroll)
    }, [active])

    if (!outline.session)
        return (
            <p className="text-muted-foreground">
                This outline isn't linked to an agent session yet. With Claude Code, the skill writes a <code>Session:</code> line (the <code>session=</code> value{' '}
                <code>bin/ensure.js</code> prints); ask the agent to add it to this outline.
            </p>
        )
    return (
        <div className="transcript">
            <div className="sticky top-[var(--barh)] z-[2] truncate border-b bg-background pt-3.5 pb-2.5 text-[1.4em] font-bold tracking-tight" data-transcript-title>
                {transcript.title || 'Untitled'}
            </div>
            {transcript.status === 'missing' ? (
                <p className="mt-3 text-muted-foreground">No transcript found for session {outline.session}.</p>
            ) : transcript.status === 'loading' ? (
                <p className="mt-3 text-muted-foreground">Loading the transcript…</p>
            ) : (
                transcript.items.map((item, i) => <Item key={item.type === 'tool-use' ? item.id : i} item={item} />)
            )}
        </div>
    )
}
