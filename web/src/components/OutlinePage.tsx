import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useApprovals } from '@/hooks/useApprovals'
import { messagesAbout, useSession } from '@/hooks/useSession'
import { referenceTo } from '@/lib/approvals'
import { useUnread } from '@/hooks/useUnread'
import { useOutline } from '@/hooks/useOutline'
import { allNodes, currentPath, isParent, nodeLabel, pathNums } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import { scrollToNode } from '@/lib/sticky'
import type { Outline, OutlineNode, QueueItem, StatePatch, ViewerState } from '@/types'
import { InboxButton } from './Inbox'
import { InputBox } from './InputBox'
import { useNotify } from './Notice'
import { OutlineTab, type NodeActions } from './OutlineTab'
import { Rail } from './Rail'
import { StatusBar } from './StatusBar'
import { TopBar, type TabName } from './TopBar'

/** One outline: its tabs, kept up to date as the agent edits the file, without reloading. */
export function OutlinePage({ project, file }: { project: string; file: string }) {
    const { state, viewer, stateLoaded, patch } = useOutline(project, file)
    const outline = state.status === 'ready' || state.status === 'gone' ? state.outline : null

    useEffect(() => {
        document.title = outline?.title || file
    }, [outline?.title, file])

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
    return <Loaded outline={outline} gone={state.status === 'gone'} viewer={viewer} stateLoaded={stateLoaded} patch={patch} />
}

interface LoadedProps {
    outline: Outline
    gone: boolean
    viewer: ViewerState
    stateLoaded: boolean
    patch: (p: StatePatch) => Promise<void>
}

function Loaded({ outline, gone, viewer, stateLoaded, patch }: LoadedProps) {
    const [tab, setTab] = useState<TabName>('outline')
    const notify = useNotify()
    const session = useSession(outline.session)
    const approvals = useApprovals(outline, viewer, patch, session.working)
    const { clickNode, clickTopic, run, reference, undo, linked } = approvals
    const [focusKey, setFocusKey] = useState(0)
    /** Linked to a session, a reference waits in the input box as a chip; otherwise it is copied. */
    const onReference = useCallback(
        (node: OutlineNode) => {
            if (!linked) return reference(node)
            const label = node.level === 1 ? `${node.num}. ${node.title}` : nodeLabel(node)
            const ref = referenceTo(outline, node)
            if (!viewer.chips.some(c => c.ref === ref)) patch({ chips: [...viewer.chips, { label, ref }] })
            setFocusKey(k => k + 1)
            notify('Added to the message box')
        },
        [linked, reference, outline, viewer.chips, patch, notify],
    )
    const messagesFor = useCallback((num: string) => messagesAbout(num, session.messages), [session.messages])
    const onSeen = useCallback((ids: string[]) => patch({ seen: Object.fromEntries(ids.map(id => [id, 1])) }), [patch])
    const { unread, opening, openUnread, unreadNums } = useUnread(outline, viewer, stateLoaded, patch)
    const actions = useMemo<NodeActions>(
        () => ({
            linked,
            onCheck: clickNode,
            onTopicCheck: clickTopic,
            onRun: run,
            onReference,
            unread,
            opening,
            onOpenUnread: openUnread,
            messagesFor,
            seen: viewer.seen,
            onSeen,
            onReveal: (num: string) => revealRef.current(num),
        }),
        [linked, clickNode, clickTopic, run, onReference, unread, opening, openUnread, messagesFor, viewer.seen, onSeen],
    )
    const statuses = useMemo(() => new Statuses(outline.nodes, viewer.overrides), [outline, viewer.overrides])

    const onToggle = useCallback((node: OutlineNode, value: boolean) => patch({ open: { [node.num]: value } }), [patch])
    const setAll = (value: boolean) => patch({ open: Object.fromEntries(allNodes(outline.nodes).filter(n => isParent(n) || n.level === 1).map(n => [n.num, value])) })

    /** Opens the way to a node (and a topic itself), then scrolls it to the top, below the headers above it. */
    const reveal = (num: string, then?: (el: HTMLElement) => void) => {
        flushSync(() => {
            setTab('outline')
            patch({ open: Object.fromEntries(pathNums(num).slice(0, num.includes('.') ? -1 : undefined).map(n => [n, true])) })
        })
        const el = document.querySelector<HTMLElement>(`.outline-tab [data-num="${CSS.escape(num)}"]`)
        if (el) setTimeout(() => scrollToNode(el, () => then?.(el)), 0)
        return !!el
    }
    /** A queue item shows its node, marked for a moment with a line in the item's color. */
    const openQueued = (item: QueueItem, color: string) => {
        const found = reveal(item.num, el => {
            el.style.setProperty('--qline', color)
            el.removeAttribute('data-qmark')
            void el.offsetWidth
            el.setAttribute('data-qmark', '')
            setTimeout(() => el.removeAttribute('data-qmark'), 1700)
        })
        if (!found) notify('Not in the outline', true)
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
        <Tabs value={tab} onValueChange={v => setTab(v as TabName)} className="block pl-[76px]">
            <Rail
                queue={outline.queue}
                statuses={statuses}
                runs={viewer.runs}
                onOpen={openQueued}
                unread={unreadNums}
                onOpenUnread={openUnreadItem}
                footer={<InboxButton messages={session.messages} seen={viewer.seen} onSeen={onSeen} onReveal={reveal} />}
            />
            <TopBar
                outline={outline}
                tab={tab}
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
            <TabsContent value="outline" forceMount hidden={tab !== 'outline'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <OutlineTab outline={outline} viewer={viewer} actions={actions} onToggle={onToggle} />
            </TabsContent>
            <TabsContent value="md" forceMount hidden={tab !== 'md'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <div className="markdown" dangerouslySetInnerHTML={{ __html: outline.markdown }} />
            </TabsContent>
            {linked && (
                <>
                    {/* Room under the content for the input box. */}
                    <div aria-hidden="true" style={{ height: 'var(--composer-h, 60px)' }} />
                    <InputBox outline={outline} viewer={viewer} patch={patch} busy={session.busy} onSent={session.working} onReveal={reveal} focusKey={focusKey} />
                </>
            )}
            {tab !== 'md' && <StatusBar outline={outline} viewer={viewer} pending={approvals.pending} onDrop={approvals.drop} onCopy={() => approvals.copyPending()} />}
        </Tabs>
    )
}
