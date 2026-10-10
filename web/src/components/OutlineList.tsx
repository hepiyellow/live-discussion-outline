import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { api, outlineHref } from '@/lib/api'
import { copyText } from '@/lib/send'
import { cn } from '@/lib/utils'
import type { OutlineList as List, OutlineSummary } from '@/types'
import { NewSession } from './NewSession'
import { RenameTitle } from './RenameTitle'
import { Rail } from './Rail'

/** The outline list, kept up to date as outlines are written, renamed or moved. */
function useOutlineList() {
    const [list, setList] = useState<List | null>(null)
    useEffect(() => {
        const es = new EventSource('/api/outlines/events')
        es.onmessage = e => setList(JSON.parse(e.data) as List)
        return () => es.close()
    }, [])
    return list
}

/** Progress: approved (green) and the agent's claims (blue) as a stacked bar, with counts. */
function Progress({ o }: { o: OutlineSummary }) {
    const cb = o.checkbox
    if (cb.total) {
        const pct = (n: number) => `${Math.round((n / cb.total) * 100)}%`
        return (
            <div className="flex items-center gap-2.5 whitespace-nowrap" title={`${cb.done} human-approved · ${cb.agent} agent-approved · ${cb.open} open (of ${cb.total} checkboxes)`}>
                <div className="flex h-2 w-[120px] shrink-0 overflow-hidden bg-border">
                    <span className="h-full shrink-0 bg-approved" style={{ width: pct(cb.done) }} />
                    <span className="h-full shrink-0 bg-claim" style={{ width: pct(cb.agent) }} />
                </div>
                <span className="text-[13px] text-muted-foreground" data-progress>
                    ✅ {cb.done} · <span className="text-claim">{cb.agent}</span> agent · ☐ {cb.open}
                </span>
            </div>
        )
    }
    const { done, open, now } = o.counts
    const total = done + open + now
    return (
        <div className="flex items-center gap-2.5 whitespace-nowrap" title={`${done} resolved of ${total}`}>
            <div className="flex h-2 w-[120px] shrink-0 overflow-hidden bg-border">
                <span className="h-full shrink-0 bg-approved" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
            </div>
            <span className="text-[13px] text-muted-foreground" data-progress>
                ✅ {done} · ❓ {open}
            </span>
        </div>
    )
}

function CopyResume({ resume }: { resume: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            type="button"
            title="Copy the link that reopens this chat"
            aria-label="Copy the link that reopens this chat"
            className="rounded-md border px-1.5 py-px hover:bg-accent"
            onClick={async e => {
                e.stopPropagation()
                if (await copyText(resume)) {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1200)
                }
            }}
        >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
    )
}

/**
 * One outline. Clicking the row opens it (⌘-click: in a new tab). The trash button asks once ("Move to trash?")
 * before it moves the outline to the trash; swiping the row left (trackpad or touch) asks the same.
 */
function Row({ o }: { o: OutlineSummary }) {
    const [armed, setArmed] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const timer = useRef<number>(undefined)
    const dx = useRef(0)
    const x0 = useRef<number | null>(null)
    const href = outlineHref(o.project, o.file)
    const arm = (on: boolean) => {
        setArmed(on)
        clearTimeout(timer.current)
        if (on) timer.current = window.setTimeout(() => setArmed(false), 5000)
    }
    useEffect(() => {
        if (!armed) return
        const off = (e: MouseEvent) => !(e.target as Element).closest(`[data-outline="${CSS.escape(`${o.project}/${o.file}`)}"]`) && setArmed(false)
        addEventListener('click', off)
        return () => removeEventListener('click', off)
    }, [armed, o.project, o.file])
    const trash = async () => {
        if (!armed) return arm(true)
        setBusy(true)
        try {
            await api('/api/delete', { project: o.project, file: o.file })
        } catch (e) {
            setError((e as Error).message)
            setBusy(false)
        }
    }
    const go = (e: React.MouseEvent | React.KeyboardEvent) => {
        if ((e.target as Element).closest('button,input')) return
        if (e.metaKey || e.ctrlKey) open(href, '_blank')
        else location.href = href
    }
    return (
        <tr
            tabIndex={0}
            data-outline={`${o.project}/${o.file}`}
            className={cn('cursor-pointer border-b hover:bg-accent/60 focus:bg-accent/60 focus:outline-none', armed && 'bg-danger/5')}
            onClick={go}
            onKeyDown={e => e.key === 'Enter' && go(e)}
            onWheel={e => {
                if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
                dx.current += e.deltaX
                if (dx.current > 40) arm(true)
                else if (dx.current < -40) arm(false)
                else return
                dx.current = 0
            }}
            onTouchStart={e => (x0.current = e.touches[0].clientX)}
            onTouchEnd={e => {
                if (x0.current === null) return
                const d = e.changedTouches[0].clientX - x0.current
                x0.current = null
                if (d < -40) arm(true)
                else if (d > 40) arm(false)
            }}
        >
            <td className="px-2.5 py-2">
                <RenameTitle project={o.project} file={o.file} title={o.title} className="inline-flex items-center">
                    <span data-title>{o.title}</span>
                </RenameTitle>
            </td>
            <td className="px-2.5 py-2">{o.project}</td>
            <td className="py-2">
                <Progress o={o} />
            </td>
            <td className="px-2.5 py-2">{o.resume && <CopyResume resume={o.resume} />}</td>
            <td className="px-2.5 py-2 text-right whitespace-nowrap text-muted-foreground">{new Date(o.mtime).toLocaleString().replace(',', '')}</td>
            <td className="w-[1%] px-1.5">
                <button
                    type="button"
                    disabled={busy}
                    title={error || 'Move to trash'}
                    aria-label={armed ? 'Move to trash?' : 'Move to trash'}
                    onClick={e => {
                        e.stopPropagation()
                        trash()
                    }}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground hover:border-border hover:text-danger',
                        armed && 'border-danger bg-danger text-white hover:text-white',
                    )}
                >
                    <Trash2 className="size-[15px]" />
                    {armed && 'Move to trash?'}
                </button>
            </td>
        </tr>
    )
}

/** The list of all outlines, newest first, with a way to start a new session. */
export function OutlineList() {
    const list = useOutlineList()
    useEffect(() => {
        document.title = 'Outlines'
    }, [])
    return (
        <div className="pl-[76px]">
            <Rail />
            <main className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <div className="mb-4 flex items-center gap-4">
                    <h1 className="flex-1 text-[1.85em] leading-tight font-bold tracking-tight">Outlines</h1>
                    <NewSession />
                </div>
                <table className="w-full border-collapse text-[15px]">
                    <thead>
                        <tr className="border-b text-left text-[13px] text-muted-foreground">
                            <th className="px-2.5 py-1.5 font-semibold">Name</th>
                            <th className="px-2.5 py-1.5 font-semibold">Project</th>
                            <th className="py-1.5 font-semibold">Progress</th>
                            <th className="px-2.5 py-1.5 font-semibold">Chat</th>
                            <th className="px-2.5 py-1.5 text-right font-semibold">Updated</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {list?.outlines.map(o => <Row key={`${o.project}/${o.file}`} o={o} />)}
                        {list && !list.outlines.length && (
                            <tr>
                                <td colSpan={6} className="px-2.5 py-3 text-muted-foreground">
                                    No outlines yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                {!list && <p className="mt-3 text-muted-foreground">Loading…</p>}
            </main>
        </div>
    )
}
