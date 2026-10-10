import { useEffect, useRef, useState, type RefObject } from 'react'
import { Folder, Layers, List, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react'
import { api, liveHref, outlineHref } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { OutlineList } from '@/types'
import { NewSession } from './NewSession'
import { RenameTitle } from './RenameTitle'

/** One row of the pane: an outline, or a session New started whose outline has not appeared yet. */
interface Row {
    key: string
    project: string
    /** An outline's file name, without `.md`. */
    file?: string
    title: string
    href: string
    /** Its last change, or when the session started. */
    mtime: number
    /** A starting session's tmux session. */
    starting?: string
}

/** The pane's rows: the starting sessions as well as the outlines. */
const rowsOf = (list: OutlineList | null): Row[] => [
    ...(list?.outlines ?? []).map(o => ({ key: `${o.project}/${o.file}`, project: o.project, file: o.file, title: o.title, href: outlineHref(o.project, o.file), mtime: o.mtime })),
    ...(list?.starting ?? []).map(s => ({ key: `starting:${s.terminal}`, project: s.project, title: s.title, href: liveHref(s.terminal), mtime: s.started, starting: s.terminal })),
]

/**
 * Rows grouped by project, each group's rows newest first: the workspaces' groups first, then single folders', each in
 * the order of their latest change.
 */
export function byProject(rows: Row[], workspaces: string[] = []) {
    const groups = new Map<string, Row[]>()
    for (const o of [...rows].sort((a, b) => b.mtime - a.mtime)) {
        const rows = groups.get(o.project)
        if (rows) rows.push(o)
        else groups.set(o.project, [o])
    }
    const all = [...groups].map(([project, rows]) => ({ project, rows, workspace: workspaces.includes(project) }))
    return [...all.filter(g => g.workspace), ...all.filter(g => !g.workspace)]
}

/**
 * The trash button of an outline's row, shown while the row is hovered: the first click asks "Move to trash?", the
 * second moves the outline to the outlines folder's `.trash/`. Asking ends after five seconds or a click elsewhere.
 */
function Trash({ project, file }: { project: string; file: string }) {
    const [armed, setArmed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const button = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!armed) return
        const timer = setTimeout(() => setArmed(false), 5000)
        const off = (e: MouseEvent) => !button.current?.contains(e.target as Node) && setArmed(false)
        addEventListener('click', off)
        return () => {
            clearTimeout(timer)
            removeEventListener('click', off)
        }
    }, [armed])
    return (
        <button
            ref={button}
            type="button"
            disabled={busy}
            aria-label={armed ? 'Move to trash?' : 'Move to trash'}
            title={error || (armed ? 'Click again to move it to the trash' : 'Move to trash')}
            onClick={async () => {
                if (!armed) return setArmed(true)
                setBusy(true)
                try {
                    await api('/api/delete', { project, file })
                } catch (e) {
                    setError((e as Error).message)
                    setBusy(false)
                    setArmed(false)
                }
            }}
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md p-1 text-muted-foreground hover:text-danger',
                armed ? 'bg-danger text-white hover:text-white' : 'hidden group-focus-within/row:inline-flex group-hover/row:inline-flex',
            )}
        >
            <Trash2 className="size-3.5" />
        </button>
    )
}

/** A row of the pane: the outline's title (renamed with its pencil, removed with its trash, both on hover), or a starting session. */
function PaneRow({ row: o, on, marked }: { row: Row; on: boolean; marked: RefObject<HTMLAnchorElement | null> }) {
    const when = new Date(o.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const link = (
        <a
            ref={on ? marked : undefined}
            href={o.href}
            {...(o.starting ? { 'data-pane-starting': o.starting } : { 'data-pane-outline': o.key })}
            aria-current={on ? 'page' : undefined}
            title={o.starting ? `${o.title}\nStarting: waiting for the agent to write the outline (tmux ${o.starting}, ${when})` : `${o.title}\n${o.project} · ${when}`}
            className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-[13px] text-sidebar-foreground no-underline', on && 'font-medium', o.starting && 'text-muted-foreground')}
        >
            {o.starting && <LoaderCircle className="size-3 shrink-0 animate-spin" aria-label="Starting" />}
            <span className="truncate">{o.title}</span>
        </a>
    )
    return (
        <li className={cn('group/row flex items-center rounded-md pr-1 hover:bg-sidebar-accent', on && 'bg-sidebar-accent')}>
            {o.file ? (
                <>
                    <RenameTitle project={o.project} file={o.file} title={o.title} className="flex min-w-0 flex-1 items-center" buttonClassName="ml-0.5 hidden group-focus-within/row:inline-flex group-hover/row:inline-flex">
                        {link}
                    </RenameTitle>
                    <Trash project={o.project} file={o.file} />
                </>
            ) : (
                link
            )}
        </li>
    )
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

/** Whether an outline matches the search: every word of it is in the outline's title or project, in any case. */
export const matches = (o: { title: string; project: string }, query: string) => {
    const text = `${o.title} ${o.project}`.toLowerCase()
    return query
        .toLowerCase()
        .split(/\s+/)
        .every(word => text.includes(word))
}

const QUERY_KEY = 'outlines-pane-search'

/** The search, kept for this tab while the viewer opens outlines from the filtered list (each opens a new page). */
function useQuery() {
    const [query, setQuery] = useState(() => {
        try {
            return sessionStorage.getItem(QUERY_KEY) ?? ''
        } catch {
            return ''
        }
    })
    const set = (q: string) => {
        setQuery(q)
        try {
            sessionStorage.setItem(QUERY_KEY, q)
        } catch {}
    }
    return [query, set] as const
}

interface Props {
    /** Null until the list arrives. */
    list: OutlineList | null
    /** The outline this page shows, if any: its row is marked. */
    current?: { project: string; file: string }
    /** On a starting session's page: its tmux session, whose row is marked. */
    starting?: string
    /** On the list of all outlines: "All outlines" is marked. */
    home?: boolean
}

/**
 * The pane on the left of every page: the way to all outlines, then every outline, grouped by project, the way Claude's
 * sidebar lists sessions, workspaces first. The search box at the top hides the outlines that do not match, and groups left empty; New
 * under it starts a session, from any page, which shows as a row at once until its outline appears. The outline (or
 * starting session) the page shows is marked and scrolled into view. Its right edge resizes it.
 */
export function OutlinesPane({ list, current, starting, home }: Props) {
    const [query, setQuery] = useQuery()
    const all = rowsOf(list)
    const groups = byProject(query.trim() ? all.filter(o => matches(o, query.trim())) : all, list?.workspaces)
    const currentKey = current ? `${current.project}/${current.file}` : starting ? `starting:${starting}` : ''
    // The marked row is scrolled into view once, when it first shows; later changes of the list leave the pane as it is.
    const marked = useRef<HTMLAnchorElement>(null)
    const shownFor = useRef('')
    useEffect(() => {
        if (!marked.current || shownFor.current === currentKey) return
        shownFor.current = currentKey
        marked.current.scrollIntoView({ block: 'nearest' })
    })
    return (
        <nav aria-label="Outlines" className="fixed inset-y-0 left-0 z-30 flex w-(--pane-w) flex-col border-r bg-sidebar text-sidebar-foreground">
            <div className="flex h-11 shrink-0 items-center px-2">
                <label className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1 text-[13px] focus-within:border-sidebar-ring">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input
                        type="search"
                        aria-label="Search outlines"
                        placeholder="Search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key !== 'Escape') return
                            if (query) setQuery('')
                            else e.currentTarget.blur()
                        }}
                        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                        <button type="button" aria-label="Clear the search" title="Clear the search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                            <X className="size-3.5" />
                        </button>
                    )}
                </label>
            </div>
            <div className="flex shrink-0 flex-col px-2">
                <NewSession
                    trigger={
                        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-sidebar-accent">
                            <Plus className="size-4" aria-hidden="true" />
                            New
                        </button>
                    }
                />
                <a
                    href="/"
                    aria-current={home ? 'page' : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent"
                >
                    <List className="size-4" aria-hidden="true" />
                    All outlines
                </a>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {!list && <p className="px-2 py-1 text-[13px] text-muted-foreground">Loading…</p>}
                {list && !groups.length && <p className="mt-3 px-2 py-1 text-[13px] text-muted-foreground">{all.length ? 'No outlines match.' : 'No outlines yet.'}</p>}
                {groups.map(g => (
                    <section key={g.project} data-project={g.project} data-workspace={g.workspace || undefined} className="mt-3">
                        <h2 className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground" title={`${g.project} (${g.workspace ? 'workspace' : 'folder'})`}>
                            {g.workspace ? <Layers className="size-3 shrink-0" aria-hidden="true" /> : <Folder className="size-3 shrink-0" aria-hidden="true" />}
                            <span className="truncate">{g.project}</span>
                        </h2>
                        <ul>
                            {g.rows.map(o => (
                                <PaneRow key={o.key} row={o} on={o.key === currentKey} marked={marked} />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <ResizeHandle />
        </nav>
    )
}
