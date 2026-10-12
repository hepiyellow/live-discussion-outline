import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useApprovals } from '@/hooks/useApprovals'
import { messagesAbout, type SessionFeed } from '@/hooks/useSession'
import type { Transcript } from '@/hooks/useTranscript'
import { referenceTo, removalOf } from '@/lib/references'
import { useUnread } from '@/hooks/useUnread'
import { useOutline } from '@/hooks/useOutline'
import { UNTITLED, allNodes, currentPath, duplicateNums, isParent, nodeLabel, pathNums } from '@/lib/outline'
import { shownNodes } from '@/lib/pending'
import { Statuses, type KindKey } from '@/lib/status'
import { scrollToNode } from '@/lib/sticky'
import type { Chip, Outline, OutlineNode, QueueItem, RemovedNode, StatePatch, TabName, ViewerState } from '@/types'
import { InboxButton } from './Inbox'
import { InputBox } from './InputBox'
import { useNotify } from './Notice'
import { OutlineTab, type NodeActions } from './OutlineTab'
import { PermissionPrompt } from './PermissionPrompt'
import { QueueColumn, type ChangeIndicator } from './QueueColumn'
import { readId } from './queue'
import { OutlinesPane } from './OutlinesPane'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'
import { TerminalTab } from './TerminalTab'
import { TranscriptTab } from './TranscriptTab'

/** What a node's chip in the input box reads: its number and title. */
const chipLabel = (node: OutlineNode) => (node.level === 1 ? `${node.num}. ${node.title}` : nodeLabel(node))

/** One outline: its tabs, kept up to date as the agent edits the file, without reloading. */
export function OutlinePage({ project, file }: { project: string; file: string }) {
    const { state, viewer, stateLoaded, patch, session, transcript, followTranscript, outlines, permissions } = useOutline(project, file)
    const outline = state.status === 'ready' || state.status === 'gone' ? state.outline : null

    useEffect(() => {
        document.title = outline?.untitled ? UNTITLED : outline?.title || file
    }, [outline?.title, outline?.untitled, file])

    if (!outline)
        return (
            <main className="mx-auto max-w-[860px] p-8 text-muted-foreground">
                {state.status === 'missing' ? (
                    <p>
                        There is no outline {project}/{file}. <a className="underline" href="/">All outlines</a>
                    </p>
                ) : (
                    <p>Loading…</p>
                )}
            </main>
        )
    return (
        <>
            <OutlinesPane list={outlines} current={{ project, file }} />
            <PermissionPrompt outline={outline} prompts={permissions} />
            {/* Keyed on the mode: which implementation of the user's ticks runs (useApprovals) is fixed for a mounted outline. */}
            <Loaded key={outline.mode} outline={outline} gone={state.status === 'gone'} viewer={viewer} stateLoaded={stateLoaded} patch={patch} session={session} transcript={transcript} followTranscript={followTranscript} />
        </>
    )
}

interface LoadedProps {
    outline: Outline
    gone: boolean
    viewer: ViewerState
    stateLoaded: boolean
    patch: (p: StatePatch) => Promise<void>
    session: SessionFeed
    transcript: Transcript
    followTranscript: () => void
}

function Loaded({ outline, gone, viewer, stateLoaded, patch, session, transcript, followTranscript }: LoadedProps) {
    // The tab lives in the viewer state; until it arrives, the Outline tab shows.
    const tab: TabName = stateLoaded ? viewer.tab : 'outline'
    const setTab = useCallback((t: TabName) => patch({ tab: t }), [patch])
    // Live tabs start following the session the first time they show.
    const [opened, setOpened] = useState<Set<TabName>>(new Set())
    useEffect(() => {
        if (!opened.has(tab)) setOpened(o => new Set(o).add(tab))
    }, [tab, opened])
    useEffect(() => {
        if (opened.has('transcript')) followTranscript()
    }, [opened, followTranscript])
    const notify = useNotify()
    const approvals = useApprovals(outline, viewer, patch, session.working)
    const { clickNode, clickTopic, run, reference, remove, undo, linked } = approvals
    // The reference last added to the input box, and how many were: the box takes the focus and its chip pulses once.
    const [added, setAdded] = useState({ ref: '', n: 0 })
    /** Adds a chip to the input box, once, and gives the box the focus. */
    const addChip = useCallback(
        (chip: Chip) => {
            if (!viewer.chips.some(c => c.ref === chip.ref)) patch({ chips: [...viewer.chips, chip] })
            setAdded(a => ({ ref: chip.ref, n: a.n + 1 }))
        },
        [viewer.chips, patch],
    )
    /** Linked to a session, a reference waits in the input box as a chip; otherwise it is copied. */
    const onReference = useCallback(
        (node: OutlineNode) => (linked ? addChip({ label: chipLabel(node), ref: referenceTo(outline, node) }) : reference(node)),
        [linked, reference, outline, addChip],
    )
    /** The trash button: the node waits in the input box as a removal, for the user to say why; otherwise it is copied. */
    const onRemove = useCallback(
        (node: OutlineNode) => (linked ? addChip({ label: chipLabel(node), ref: removalOf(outline, node), kind: 'remove' }) : remove(node)),
        [linked, remove, outline, addChip],
    )
    const messagesFor = useCallback((num: string) => messagesAbout(num, session.messages), [session.messages])
    const onSeen = useCallback((ids: string[]) => patch({ seen: Object.fromEntries(ids.map(id => [id, 1])) }), [patch])
    const { pending, unread, opening, openChange, unreadNums, unreadUnder, openUnreadUnder } = useUnread(outline, viewer, stateLoaded, patch)
    // The outline as the viewer sees it: a node whose change waits is as they read it, and an added one a bare row.
    const shown = useMemo(() => shownNodes(outline.nodes, pending), [outline, pending])
    // The nodes taken out that the viewer has not seen go, each where it stood, as long as that place is shown.
    const removed = useMemo<RemovedNode[]>(() => {
        if (!stateLoaded) return []
        const there = new Set(allNodes(shown).map(n => n.num))
        return outline.removed.filter(t => !viewer.seen[`removed:${t.id}`] && (!t.parent || there.has(t.parent)))
    }, [outline.removed, viewer.seen, shown, stateLoaded])
    const removedUnder = useCallback((num: string) => removed.filter(t => t.parent === num || t.parent.startsWith(`${num}.`)), [removed])
    const actions = useMemo<NodeActions>(() => {
        // The rows hold the nodes as they are shown; what the user does applies to the node as it is. A node whose
        // change waits takes no approval: the user has not seen what they would approve.
        const live = (node: OutlineNode) => allNodes(outline.nodes).find(n => n.num === node.num) ?? node
        return {
            linked,
            onCheck: node => {
                if (!pending.has(node.num)) clickNode(live(node))
            },
            onTopicCheck: topic => {
                if (!pending.has(topic.num)) clickTopic(live(topic))
            },
            onRun: node => run(live(node)),
            onReference: node => onReference(live(node)),
            onRemove: node => onRemove(live(node)),
            pending,
            unread,
            opening,
            // A node's diff button opens everything under it: the nodes taken out there are seen to go with it.
            onOpenChange: node => {
                openChange(live(node))
                const gone = removedUnder(node.num)
                if (gone.length) onSeen(gone.map(t => `removed:${t.id}`))
            },
            removedIn: parent => removed.filter(t => t.parent === parent),
            removedUnder: num => removedUnder(num).length,
            onSeenRemoved: t => onSeen([`removed:${t.id}`]),
            unreadUnder,
            onOpenUnreadUnder: node => openUnreadUnder(live(node)),
            messagesFor,
            seen: viewer.seen,
            onSeen,
            onReveal: (num: string, then?: (el: HTMLElement) => void, inside?: boolean) => revealRef.current(num, then, inside),
        }
    }, [outline, linked, clickNode, clickTopic, run, onReference, onRemove, pending, unread, opening, openChange, removed, removedUnder, unreadUnder, openUnreadUnder, messagesFor, viewer.seen, onSeen])
    const statuses = useMemo(() => new Statuses(outline.nodes, viewer.overrides), [outline, viewer.overrides])
    /**
     * The change indicators of the queue column: in outline order, or the oldest change first when the viewer chose
     * so (the server says when its agent changed each node). One of a node whose own kind mark changes is drawn with
     * the new mark, which is what opening the change brings.
     */
    const changes = useMemo<ChangeIndicator[]>(() => {
        const was = new Statuses(shown, viewer.overrides)
        const before = new Map(allNodes(shown).map(n => [n.num, n]))
        const after = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
        const keyOf = (s: Statuses, node?: OutlineNode): KindKey | undefined => node && (node.level === 1 ? s.topicBox(node) : s.box(node)).markKey
        const list: (ChangeIndicator & { at: number })[] = [
            ...unreadNums.map(num => {
                const change = pending.get(num)!
                const mark = change.kind === 'changed' ? keyOf(statuses, after.get(num)) : undefined
                return { num, kind: change.kind, done: change.done, mark: mark && mark !== keyOf(was, before.get(num)) ? mark : undefined, at: outline.changedAt[num] ?? 0 }
            }),
            ...removed.map(t => ({ num: t.num, kind: 'removed' as const, id: t.id, at: t.at })),
        ]
        const byNumber = (a: ChangeIndicator, b: ChangeIndicator) => {
            const [x, y] = [a.num.split('.').map(Number), b.num.split('.').map(Number)]
            for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1)
            return 0
        }
        return list.sort((a, b) => (viewer.order === 'time' && a.at !== b.at ? a.at - b.at : byNumber(a, b)))
    }, [outline, shown, viewer.overrides, viewer.order, statuses, unreadNums, pending, removed])
    const duplicates = useMemo(() => duplicateNums(outline.nodes), [outline])

    const onToggle = useCallback((node: OutlineNode, value: boolean) => patch({ open: { [node.num]: value } }), [patch])
    const setAll = (value: boolean) => patch({ open: Object.fromEntries(allNodes(outline.nodes).filter(n => isParent(n) || n.level === 1).map(n => [n.num, value])) })

    /**
     * Opens the way to a node (and a topic itself), then scrolls it to the top, below the headers above it. With
     * `inside`, a node that has nodes under it is opened too: what there is to do is in them (a question's options). So
     * is an action, whose Run button is in its text.
     */
    const reveal = (asked: string, then?: (el: HTMLElement) => void, inside = false) => {
        // A node inside one that was added and is not opened yet is not shown: the added node is, with its plus.
        const there = new Set(allNodes(shown).map(n => n.num))
        const num = pathNums(asked).reverse().find(n => there.has(n)) ?? asked
        const parent = inside && allNodes(shown).some(n => n.num === num && (n.children.length > 0 || n.tags.includes('action')))
        flushSync(() => {
            if (tab !== 'outline') setTab('outline')
            patch({ open: Object.fromEntries(pathNums(num).slice(0, parent || !num.includes('.') ? undefined : -1).map(n => [n, true])) })
        })
        const el = document.querySelector<HTMLElement>(`.outline-tab [data-num="${CSS.escape(num)}"]`)
        if (el) setTimeout(() => scrollToNode(el, () => then?.(el)), 0)
        return !!el
    }
    /**
     * An item of the action queue shows its node, marked for a moment with a line in the item's color. A node changed
     * since the viewer read it shows what they read: its diff button pulses, as the thing to click first. An item
     * that only asks for a node to be read (file mode) is handled by showing it.
     */
    const openQueued = (item: QueueItem, color: string) => {
        const found = reveal(item.num, el => {
            el.style.setProperty('--qline', color)
            el.removeAttribute('data-qmark')
            void el.offsetWidth
            el.setAttribute('data-qmark', '')
            setTimeout(() => el.removeAttribute('data-qmark'), 1700)
            const env = el.querySelector<HTMLElement>(':scope > .env')
            env?.removeAttribute('data-pulse')
            void env?.offsetWidth
            env?.setAttribute('data-pulse', '')
        }, true)
        if (!found) return notify('Not in the outline', true)
        const node = item.kind === 'read' ? allNodes(outline.nodes).find(n => n.num === item.num) : undefined
        if (node) onSeen([readId(item, node)])
    }
    /** The indicator of a removed node shows the row where it stood, and points at its minus. */
    const openRemovedItem = (id: string) => {
        const gone = removed.find(t => t.id === id)
        if (!gone) return
        flushSync(() => {
            if (tab !== 'outline') setTab('outline')
            if (gone.parent) patch({ open: Object.fromEntries(pathNums(gone.parent).map(n => [n, true])) })
        })
        const el = document.querySelector<HTMLElement>(`.outline-tab [data-removed="${CSS.escape(id)}"]`)
        if (!el) return
        setTimeout(() =>
            scrollToNode(el, () => {
                const env = el.querySelector<HTMLElement>(':scope > .env')
                env?.removeAttribute('data-pulse')
                void env?.offsetWidth
                env?.setAttribute('data-pulse', '')
            }),
        )
    }
    /** An unread item shows its node, and points at its diff button: the change opens from there. */
    const openUnreadItem = (num: string) =>
        reveal(num, el => {
            el.style.setProperty('--qline', 'var(--claim)')
            el.removeAttribute('data-qmark')
            void el.offsetWidth
            el.setAttribute('data-qmark', '')
            setTimeout(() => el.removeAttribute('data-qmark'), 1700)
            const env = el.querySelector(':scope > .env')
            env?.removeAttribute('data-pulse')
            void (env as HTMLElement | null)?.offsetWidth
            env?.setAttribute('data-pulse', '')
        })
    const revealRef = useRef(reveal)
    revealRef.current = reveal
    const current = [...currentPath(outline.nodes)].pop()

    // ⌘Z (Ctrl+Z) outside text fields takes back the last approval.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
            if ((e.target as Element).closest?.('input:not([type=checkbox]),textarea,[contenteditable],.xterm')) return
            e.preventDefault()
            undo()
        }
        addEventListener('keydown', onKey)
        return () => removeEventListener('keydown', onKey)
    }, [undo])

    return (
        <Tabs
            value={tab}
            onValueChange={v => setTab(v as TabName)}
            className="block pl-(--pane-w)"
            style={{ '--qbottom': linked && tab !== 'term' ? 'var(--composer-h, 60px)' : '0px' } as React.CSSProperties}
        >
            <TopBar
                outline={outline}
                tab={tab}
                onTab={setTab}
                onExpandAll={() => setAll(true)}
                onCollapseAll={() => setAll(false)}
                onJump={current ? () => reveal(current) : undefined}
                undoSteps={viewer.undo.length}
                onUndo={undo}
            />
            {gone && (
                <p role="status" className="mx-auto mt-4 max-w-[860px] rounded-md border border-danger/40 px-4 py-2 text-sm text-danger">
                    This outline was moved or deleted. What you see is its last version.
                </p>
            )}
            {duplicates.length > 0 && (
                <p role="alert" data-duplicates className="mx-auto mt-4 max-w-[860px] rounded-md border border-danger/40 px-4 py-2 text-sm text-danger">
                    More than one node is numbered {duplicates.join(', ')}. Approving, picking or running one of them acts on the others too, and the agent is told the wrong
                    title. Ask the agent to give every node its own number.
                </p>
            )}
            <TabsContent value="outline" forceMount hidden={tab !== 'outline'} className="outline-col pt-4 pb-20">
                <QueueColumn
                    queue={outline.queue}
                    statuses={statuses}
                    runs={viewer.runs}
                    seen={viewer.seen}
                    onOpen={openQueued}
                    changes={changes}
                    onOpenUnread={change => (change.kind === 'removed' ? openRemovedItem(change.id ?? '') : openUnreadItem(change.num))}
                    order={viewer.order}
                    onOrder={outline.mode === 'server' ? order => patch({ order }) : undefined}
                    ready={stateLoaded}
                    footer={<InboxButton messages={session.messages} seen={viewer.seen} onSeen={onSeen} onReveal={reveal} />}
                />
                <OutlineTab outline={outline} shown={shown} viewer={viewer} actions={actions} onToggle={onToggle} />
            </TabsContent>
            <TabsContent value="md" forceMount hidden={tab !== 'md'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <div className="markdown" dangerouslySetInnerHTML={{ __html: outline.markdown }} />
            </TabsContent>
            <TabsContent value="transcript" forceMount hidden={tab !== 'transcript'} className="mx-auto max-w-[900px] px-5 pb-20">
                <TranscriptTab outline={outline} transcript={transcript} active={tab === 'transcript'} />
            </TabsContent>
            <TabsContent value="term" forceMount hidden={tab !== 'term'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <TerminalTab outline={outline} active={tab === 'term'} opened={opened.has('term')} />
            </TabsContent>
            {/* The Terminal tab takes typing itself. */}
            {linked && tab !== 'term' && (
                <>
                    {/* Room under the content for the input box. */}
                    <div aria-hidden="true" style={{ height: 'var(--composer-h, 60px)' }} />
                    <InputBox outline={outline} viewer={viewer} patch={patch} busy={session.busy} using={session.using} onSent={session.working} onReveal={reveal} added={added} inOutline={tab === 'outline'} />
                </>
            )}
            {/* File mode only: in server mode a tick is recorded at once, and nothing waits to be copied. */}
            {tab === 'outline' && 'pending' in approvals && <StatusBar outline={outline} viewer={viewer} pending={approvals.pending} onDrop={approvals.drop} onCopy={() => approvals.copyPending()} />}
        </Tabs>
    )
}
