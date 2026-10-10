import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
    project: string
    file: string
    title: string
    className?: string
    /** What the title is shown in while not edited. */
    children: React.ReactNode
    /** Classes added to the pencil button. */
    buttonClassName?: string
}

/**
 * A title with a pencil beside it: click, type a new name, Enter saves (the server rewrites the outline's Title:
 * line), Escape cancels. The outline's stream brings the new name back.
 */
export function RenameTitle({ project, file, title, className, children, buttonClassName }: Props) {
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(title)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const input = useRef<HTMLInputElement>(null)
    const done = useRef(false)

    useEffect(() => {
        if (!editing) return
        input.current?.focus()
        input.current?.select()
    }, [editing])

    const close = () => {
        done.current = true
        setEditing(false)
        setError('')
    }
    const save = async () => {
        if (busy || done.current) return
        const name = value.trim()
        if (!name || name === title) return close()
        setBusy(true)
        try {
            await api('/api/rename', { project, file, title: name })
            close()
        } catch (e) {
            setError((e as Error).message)
            input.current?.focus()
        }
        setBusy(false)
    }

    if (editing)
        return (
            <span className={cn('block', className)} onClick={e => e.stopPropagation()}>
                <input
                    ref={input}
                    type="text"
                    maxLength={300}
                    value={value}
                    disabled={busy}
                    aria-label="Outline name"
                    className="w-full rounded-md border bg-background px-1.5 [font:inherit] [letter-spacing:inherit] disabled:opacity-60"
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            save()
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            close()
                        }
                    }}
                    onBlur={save}
                />
                {error && <span className="mt-1 block text-[13px] font-normal tracking-normal text-danger">{error}</span>}
            </span>
        )
    return (
        <span className={cn('group/rename', className)}>
            {children}
            <button
                type="button"
                title="Rename"
                aria-label="Rename"
                className={cn(
                    'ml-2 inline-flex shrink-0 rounded-md border border-transparent p-1 align-middle text-muted-foreground opacity-60 hover:border-border hover:text-foreground hover:opacity-100 focus-visible:opacity-100',
                    buttonClassName,
                )}
                onClick={e => {
                    e.stopPropagation()
                    done.current = false
                    setValue(title)
                    setEditing(true)
                }}
            >
                <Pencil className="size-3.5" />
            </button>
        </span>
    )
}
