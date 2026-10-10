import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { sendToSession } from '@/lib/send'
import { cn } from '@/lib/utils'
import type { Chip, Outline, SlashCommand, StatePatch, ViewerState } from '@/types'
import { useNotify } from './Notice'

interface Props {
    outline: Outline
    viewer: ViewerState
    patch: (p: StatePatch) => Promise<void>
    busy: boolean
    /** Something was sent: the agent is in a turn. */
    onSent: () => void
    onReveal: (num: string) => void
    /** Focuses the box when this changes (a chip was just added). */
    focusKey: number
}

/** How long typing pauses before the draft is saved. */
const DRAFT_DELAY = 300

/** The number a chip's label starts with, if any: clicking the chip shows that node. */
const chipNum = (c: Chip) => /^(\d+(?:\.\d+)*)\.?\s/.exec(c.label)?.[1]

/**
 * The input box at the bottom: types a message into the linked session's terminal. References added from the outline
 * wait in it as chips, sent as `Re: outline …` lines before the text. Its draft and chips live in the viewer state, so
 * every window on the outline shares them. `/` at the start lists the session's commands.
 */
export function InputBox({ outline, viewer, patch, busy, onSent, onReveal, focusKey }: Props) {
    const notify = useNotify()
    const root = useRef<HTMLFormElement>(null)
    const box = useRef<HTMLTextAreaElement>(null)
    const [text, setText] = useState(viewer.draft)
    const [sending, setSending] = useState(false)
    const saved = useRef(viewer.draft)
    const timer = useRef<number>(undefined)
    const chips = viewer.chips

    // Another window changed the draft: take it.
    useEffect(() => {
        if (viewer.draft === saved.current) return
        saved.current = viewer.draft
        setText(viewer.draft)
    }, [viewer.draft])

    const edit = (value: string) => {
        setText(value)
        saved.current = value
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => patch({ draft: value }), DRAFT_DELAY)
    }

    useEffect(() => {
        if (focusKey) box.current?.focus()
    }, [focusKey])

    // The box grows with its text; the page keeps its height in --composer-h so content clears it.
    useLayoutEffect(() => {
        const el = box.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight + 2}px`
    }, [text])
    useEffect(() => {
        const el = root.current
        if (!el) return
        const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--composer-h', `${el.offsetHeight}px`))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Slash commands: fetched once, when first asked for.
    const [commands, setCommands] = useState<SlashCommand[] | null>(null)
    const [caret, setCaret] = useState(0)
    const [focused, setFocused] = useState(false)
    const [selected, setSelected] = useState('')
    const [menuClosed, setMenuClosed] = useState(false)
    const query = focused && !menuClosed ? /^\/(\S*)$/.exec(text.slice(0, caret))?.[1] : undefined
    useEffect(() => {
        if (query === undefined || commands) return
        setCommands([])
        fetch(`/api/commands?session=${encodeURIComponent(outline.session)}`)
            .then(r => (r.ok ? r.json() : []))
            .then(setCommands)
            .catch(() => {})
    }, [query, commands, outline.session])
    const shown = useMemo(() => {
        if (query === undefined || !commands) return []
        const q = query.toLowerCase()
        const name = (c: SlashCommand) => c.name.toLowerCase()
        return [...commands.filter(c => name(c).startsWith(q)), ...commands.filter(c => !name(c).startsWith(q) && name(c).includes(q))]
    }, [query, commands])
    useEffect(() => setSelected(shown[0]?.name ?? ''), [shown])

    const pick = (name: string) => {
        const el = box.current
        const rest = text.slice(el?.selectionStart ?? text.length).replace(/^\S*\s*/, '')
        const value = `/${name} ${rest}`
        edit(value)
        setMenuClosed(true)
        const at = name.length + 2
        requestAnimationFrame(() => {
            el?.setSelectionRange(at, at)
            setCaret(at)
        })
    }

    const setChips = (next: Chip[]) => patch({ chips: next })

    const submit = async () => {
        const message = [...chips.map(c => c.ref), text.trim()].filter(Boolean).join('\n')
        if (!message || sending) return
        setSending(true)
        try {
            await sendToSession(outline.terminal, message)
            clearTimeout(timer.current)
            setText('')
            saved.current = ''
            patch({ draft: '', chips: [] })
            onSent()
        } catch (e) {
            notify(`Not sent: ${(e as Error).message}`, true)
        } finally {
            setSending(false)
            box.current?.focus()
        }
    }

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (shown.length) {
            const i = Math.max(0, shown.findIndex(c => c.name === selected))
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected(shown[(i + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length].name)
                return
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
                e.preventDefault()
                pick(shown[i].name)
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                setMenuClosed(true)
                return
            }
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
        } else if (e.key === 'Backspace' && !e.currentTarget.selectionStart && !e.currentTarget.selectionEnd && chips.length) {
            setChips(chips.slice(0, -1))
        }
    }

    const empty = !text.trim() && !chips.length
    return (
        <form
            id="composer"
            ref={root}
            onSubmit={e => {
                e.preventDefault()
                submit()
            }}
            className="fixed right-0 bottom-0 left-[76px] z-[15] flex items-end gap-2 border-t bg-background px-5 py-2.5"
        >
            {shown.length > 0 && (
                <Command value={selected} onValueChange={setSelected} shouldFilter={false} className="absolute right-16 bottom-[calc(100%+6px)] left-5 h-auto w-auto border shadow-lg">
                    <CommandList label="Slash commands" className="max-h-[min(320px,50vh)]">
                        {shown.map(c => (
                            <CommandItem
                                key={c.name}
                                value={c.name}
                                title={c.source}
                                onMouseDown={e => e.preventDefault()}
                                onSelect={() => pick(c.name)}
                                className="block"
                            >
                                <b className="font-semibold">/{c.name}</b> {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
                                {c.description && <div className="truncate text-xs text-muted-foreground">{c.description}</div>}
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            )}
            <span
                role="status"
                aria-label={busy ? 'The agent is working' : 'The agent is idle'}
                data-busy={busy || undefined}
                className={cn('size-4 shrink-0 self-center rounded-full border-2 border-border border-t-claim', busy ? 'visible animate-spin' : 'invisible')}
            />
            <div className="flex min-w-0 flex-1 flex-col rounded-[18px] border px-1.5 py-1 focus-within:border-muted-foreground">
                {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-0.5 pt-0.5" aria-label="References">
                        {chips.map((c, i) => {
                            const num = chipNum(c)
                            return (
                                <span
                                    key={c.ref}
                                    data-chip={c.label}
                                    title={c.ref}
                                    onClick={e => num && !(e.target as Element).closest('button') && onReveal(num)}
                                    className={cn('inline-flex max-w-full items-center gap-0.5 rounded-[10px] bg-muted py-px pr-0.5 pl-2.5 text-xs', num && 'cursor-pointer hover:bg-accent')}
                                >
                                    <span className="truncate">{c.label}</span>
                                    <button
                                        type="button"
                                        title="Remove"
                                        aria-label={`Remove ${c.label}`}
                                        className="px-1 text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                            setChips(chips.filter((_, j) => j !== i))
                                            box.current?.focus()
                                        }}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            )
                        })}
                    </div>
                )}
                <textarea
                    ref={box}
                    rows={1}
                    value={text}
                    aria-label="Message the session"
                    placeholder="Message the session · Enter sends, Shift+Enter adds a line"
                    title={`Typed into tmux ${outline.terminal}`}
                    className="max-h-[40vh] resize-none border-0 bg-transparent px-2 py-[3px] leading-[1.45] outline-none"
                    onChange={e => {
                        edit(e.target.value)
                        setCaret(e.target.selectionStart)
                        setMenuClosed(false)
                    }}
                    onSelect={e => setCaret(e.currentTarget.selectionStart)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                />
            </div>
            <button
                type="submit"
                title="Send"
                aria-label="Send"
                disabled={empty || sending}
                className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-claim text-white disabled:cursor-default disabled:opacity-40"
            >
                <ArrowUp className="size-4" />
            </button>
        </form>
    )
}
