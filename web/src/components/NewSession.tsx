import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DirListing, StartOptions } from '@/types'

type Kind = 'workspace' | 'folder' | 'resume'
type StartRequest = { kind: 'workspace'; file: string; topic: string } | { kind: 'folder'; path: string; topic: string } | { kind: 'resume'; id: string; stopOther?: boolean }
type OpenIn = { app: string; pid?: number; tmux?: string }

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/** The page for a session just started: its terminal, until the agent writes the outline. */
const liveHref = (terminal: string) => `/live?t=${encodeURIComponent(terminal)}`

const row = 'flex cursor-pointer items-baseline gap-2.5 rounded-md px-2 py-[7px] hover:bg-accent'

/**
 * "New session": starts an agent session in tmux from a Cursor workspace, a folder, or a past Claude Code session
 * (resumed), with the skill as its first message, and shows its terminal until the outline appears.
 */
export function NewSession() {
    const [open, setOpen] = useState(false)
    const [kind, setKind] = useState<Kind>('workspace')
    const [options, setOptions] = useState<StartOptions | null>(null)
    const [dir, setDir] = useState<DirListing | null>(null)
    const [path, setPath] = useState('')
    const [workspace, setWorkspace] = useState('')
    const [session, setSession] = useState('')
    const [topic, setTopic] = useState('')
    const [error, setError] = useState('')
    const [openIn, setOpenIn] = useState<{ request: StartRequest; where: OpenIn } | null>(null)
    const [busy, setBusy] = useState(false)

    const cd = async (to: string) => {
        try {
            const d = await api<DirListing>(`/api/dirs?path=${encodeURIComponent(to)}`)
            setDir(d)
            setPath(d.path)
            setError('')
        } catch (e) {
            setError((e as Error).message)
        }
    }

    useEffect(() => {
        if (!open || options) return
        api<StartOptions>('/api/start-options')
            .then(o => {
                setOptions(o)
                setWorkspace(o.workspaces[0]?.file ?? '')
                setSession(o.sessions[0]?.id ?? '')
                if (!o.workspaces.length) setKind('folder')
            })
            .catch(e => setError((e as Error).message))
        cd('~')
    }, [open, options])

    const start = async (request: StartRequest) => {
        setBusy(true)
        setError('')
        setOpenIn(null)
        try {
            const { terminal } = await api<{ terminal: string }>('/api/start', request)
            location.href = liveHref(terminal)
            return
        } catch (e) {
            setError((e as Error).message)
            const where = ((e as Error & { data?: { openIn?: OpenIn } }).data ?? {}).openIn
            if (where) setOpenIn({ request, where })
        }
        setBusy(false)
    }
    const request = (): StartRequest | null => {
        if (kind === 'workspace') return workspace ? { kind, file: workspace, topic: topic.trim() } : null
        if (kind === 'folder') return { kind, path, topic: topic.trim() }
        return session ? { kind, id: session } : null
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    New session
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[min(720px,calc(100vh-48px))] w-[min(720px,calc(100vw-32px))] flex-col gap-0 p-0 sm:max-w-none">
                <DialogHeader className="px-5 pt-4 pb-2">
                    <DialogTitle>New session</DialogTitle>
                    <DialogDescription className="sr-only">Start an agent session in tmux, linked to a new outline.</DialogDescription>
                </DialogHeader>
                <Tabs
                    value={kind}
                    onValueChange={k => {
                        setKind(k as Kind)
                        setError('')
                        setOpenIn(null)
                    }}
                    className="min-h-0 flex-1 gap-0"
                >
                    <TabsList className="mx-5">
                        <TabsTrigger value="workspace">Workspace</TabsTrigger>
                        <TabsTrigger value="folder">Folder</TabsTrigger>
                        <TabsTrigger value="resume">Resume a session</TabsTrigger>
                    </TabsList>
                    <TabsContent value="workspace" className="min-h-[220px] overflow-auto px-5 py-2.5">
                        <p className="mt-1 mb-2 text-[13px] text-muted-foreground">
                            Claude starts in the folder holding the workspace file, with the workspace's folders added. The outline files under the workspace's name.
                        </p>
                        {!options ? (
                            <p className="text-sm">Loading…</p>
                        ) : options.workspaces.length ? (
                            <div role="radiogroup" aria-label="Workspaces">
                                {options.workspaces.map(w => (
                                    <label key={w.file} className={row}>
                                        <input type="radio" name="ws" checked={workspace === w.file} onChange={() => setWorkspace(w.file)} />
                                        <span className="min-w-0">
                                            <b>{w.name}</b>
                                            <span className="block truncate text-xs text-muted-foreground">{w.folders.map(f => f.name).join(' · ')}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[13px] text-muted-foreground">
                                No workspace files (.code-workspace) found. Set <code>workspaceDirs</code> in the config to the folders that hold them.
                            </p>
                        )}
                    </TabsContent>
                    <TabsContent value="folder" className="min-h-[220px] overflow-auto px-5 py-2.5">
                        <div className="mb-1.5 flex gap-2">
                            <input
                                type="text"
                                spellCheck={false}
                                aria-label="Folder"
                                value={path}
                                onChange={e => setPath(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        cd(path)
                                    }
                                }}
                                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-[13px]"
                            />
                            <Button variant="outline" size="sm" title="Parent folder" onClick={() => cd(dir?.parent ?? '~')}>
                                Up
                            </Button>
                        </div>
                        <p className="mt-1 mb-2 text-[13px] text-muted-foreground">Claude starts in the folder shown above. Click a subfolder to open it.</p>
                        {dir &&
                            (dir.dirs.length ? (
                                dir.dirs.map(d => (
                                    <div key={d.name} className={row} role="button" tabIndex={0} onClick={() => cd(`${dir.path}/${d.name}`)} onKeyDown={e => e.key === 'Enter' && cd(`${dir.path}/${d.name}`)}>
                                        <span>{d.name}</span>
                                        {d.repo && <span className="rounded-[10px] bg-claim/15 px-1.5 text-[11px] text-claim">git</span>}
                                    </div>
                                ))
                            ) : (
                                <p className="text-[13px] text-muted-foreground">No subfolders.</p>
                            ))}
                    </TabsContent>
                    <TabsContent value="resume" className="min-h-[220px] overflow-auto px-5 py-2.5">
                        <p className="mt-1 mb-2 text-[13px] text-muted-foreground">
                            Continues that conversation in a new terminal, linked to an outline. A session marked "open in …" is still running in another app; two apps writing one session
                            conflict, so Start offers to stop it there first.
                        </p>
                        {!options ? (
                            <p className="text-sm">Loading…</p>
                        ) : options.sessions.length ? (
                            <div role="radiogroup" aria-label="Sessions">
                                {options.sessions.map(s => (
                                    <label key={s.id} className={row}>
                                        <input type="radio" name="ses" checked={session === s.id} onChange={() => setSession(s.id)} />
                                        <span className="min-w-0">
                                            {s.title}
                                            <span className="block truncate text-xs text-muted-foreground">{s.cwd}</span>
                                        </span>
                                        {s.openIn && (
                                            <span className="rounded-[10px] bg-[#bf8700]/15 px-1.5 text-[11px] whitespace-nowrap text-[#bf8700]" title={`Running now (process ${s.openIn.pid})`}>
                                                open in {s.openIn.app}
                                            </span>
                                        )}
                                        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">{ago(s.mtime)}</span>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[13px] text-muted-foreground">No Claude Code sessions found in ~/.claude/projects.</p>
                        )}
                    </TabsContent>
                </Tabs>
                <div className="flex flex-col gap-2 border-t px-5 py-3">
                    <label className={cn('flex items-center gap-2 text-[13px]', kind === 'resume' && 'hidden')}>
                        Topic
                        <input
                            type="text"
                            value={topic}
                            placeholder="What the session is about (optional)"
                            onChange={e => setTopic(e.target.value)}
                            onKeyDown={e => {
                                const r = request()
                                if (e.key === 'Enter' && r) start(r)
                            }}
                            className="flex-1 rounded-md border bg-background px-2 py-1.5"
                        />
                    </label>
                    <p role="alert" className="m-0 min-h-[1em] text-[13px] text-danger">
                        {error}
                        {openIn &&
                            (openIn.where.tmux ? (
                                <button type="button" className="ml-1.5 rounded-md border px-2 py-0.5 text-xs text-foreground" onClick={() => (location.href = liveHref(openIn.where.tmux!))}>
                                    Open it
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="ml-1.5 rounded-md border px-2 py-0.5 text-xs text-foreground"
                                    onClick={() => openIn.request.kind === 'resume' && start({ ...openIn.request, stopOther: true })}
                                >
                                    Stop it in {openIn.where.app} and resume here
                                </button>
                            ))}
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            disabled={busy || !request()}
                            onClick={() => {
                                const r = request()
                                if (r) start(r)
                            }}
                        >
                            Start
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
