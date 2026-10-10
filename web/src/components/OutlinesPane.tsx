import { useEffect, useRef } from 'react'
import { List } from 'lucide-react'
import { outlineHref } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { OutlineList, OutlineSummary } from '@/types'

/** Outlines grouped by project: the groups in the order of their latest change, each group's outlines newest first. */
export function byProject(outlines: OutlineSummary[]) {
    const groups = new Map<string, OutlineSummary[]>()
    for (const o of [...outlines].sort((a, b) => b.mtime - a.mtime)) {
        const rows = groups.get(o.project)
        if (rows) rows.push(o)
        else groups.set(o.project, [o])
    }
    return [...groups].map(([project, rows]) => ({ project, rows }))
}

const WIDTH_KEY = 'outlines-pane-width'
const MIN_WIDTH = 180
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 260

/** Sets the pane's width (--pane-w), which the page's other fixed parts start after. */
const setWidth = (px: number) => document.documentElement.style.setProperty('--pane-w', `${Math.round(px)}px`)

// The width the viewer last dragged the pane to, in this browser; a convenience only, so a failure leaves the default.
try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved)
} catch {}

/** The pane's right edge: drag to resize, double-click for the default width. */
function ResizeHandle() {
    const save = (px: number) => {
        try {
            localStorage.setItem(WIDTH_KEY, String(Math.round(px)))
        } catch {}
    }
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the outlines pane"
            title="Drag to resize; double-click to reset"
            className="absolute inset-y-0 -right-[3px] z-10 w-[6px] cursor-col-resize hover:bg-sidebar-ring/40 active:bg-sidebar-ring/60"
            onPointerDown={e => {
                e.preventDefault()
                const handle = e.currentTarget
                handle.setPointerCapture(e.pointerId)
                let px = 0
                const move = (ev: PointerEvent) => {
                    px = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX))
                    setWidth(px)
                }
                const up = () => {
                    handle.removeEventListener('pointermove', move)
                    handle.removeEventListener('pointerup', up)
                    document.body.style.cursor = ''
                    document.body.style.userSelect = ''
                    if (px) save(px)
                }
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
                handle.addEventListener('pointermove', move)
                handle.addEventListener('pointerup', up)
            }}
            onDoubleClick={() => {
                setWidth(DEFAULT_WIDTH)
                save(DEFAULT_WIDTH)
            }}
        />
    )
}

interface Props {
    /** Null until the list arrives. */
    list: OutlineList | null
    /** The outline this page shows, if any: its row is marked. */
    current?: { project: string; file: string }
    /** On the list of all outlines: "All outlines" is marked. */
    home?: boolean
}

/**
 * The pane on the left of every page: the way to all outlines, then every outline, grouped by project, the way Claude's
 * sidebar lists sessions. The outline the page shows is marked and scrolled into view. Its right edge resizes it.
 */
export function OutlinesPane({ list, current, home }: Props) {
    const groups = list ? byProject(list.outlines) : []
    // The marked row is scrolled into view once, when it first shows; later changes of the list leave the pane as it is.
    const marked = useRef<HTMLAnchorElement>(null)
    const shownFor = useRef('')
    useEffect(() => {
        const key = current ? `${current.project}/${current.file}` : ''
        if (!marked.current || shownFor.current === key) return
        shownFor.current = key
        marked.current.scrollIntoView({ block: 'nearest' })
    })
    return (
        <nav aria-label="Outlines" className="fixed inset-y-0 left-0 z-30 flex w-(--pane-w) flex-col border-r bg-sidebar text-sidebar-foreground">
            <div className="flex h-11 shrink-0 items-center px-2">
                <a
                    href="/app/"
                    aria-current={home ? 'page' : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent"
                >
                    <List className="size-4" aria-hidden="true" />
                    All outlines
                </a>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {!list && <p className="px-2 py-1 text-[13px] text-muted-foreground">Loading…</p>}
                {list && !groups.length && <p className="px-2 py-1 text-[13px] text-muted-foreground">No outlines yet.</p>}
                {groups.map(g => (
                    <section key={g.project} data-project={g.project} className="mt-3">
                        <h2 className="truncate px-2 pb-1 text-xs font-medium text-muted-foreground" title={g.project}>
                            {g.project}
                        </h2>
                        <ul>
                            {g.rows.map(o => {
                                const on = current?.project === o.project && current.file === o.file
                                return (
                                    <li key={o.file}>
                                        <a
                                            ref={on ? marked : undefined}
                                            href={outlineHref(o.project, o.file)}
                                            data-pane-outline={`${o.project}/${o.file}`}
                                            aria-current={on ? 'page' : undefined}
                                            title={`${o.title}\n${o.project} · ${new Date(o.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                                            className={cn('block truncate rounded-md px-2 py-1 text-[13px] text-sidebar-foreground no-underline hover:bg-sidebar-accent', on && 'bg-sidebar-accent font-medium')}
                                        >
                                            {o.title}
                                        </a>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                ))}
            </div>
            <ResizeHandle />
        </nav>
    )
}
