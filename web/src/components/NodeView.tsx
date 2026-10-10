import { createContext, useContext, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, Copy, Reply } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Statuses } from '@/lib/status'
import { DONE_PILL, FAILED_PILL, contentHtml, type NodeContent } from '@/lib/content'
import type { Message, OutlineNode, QueueItem } from '@/types'
import { NodeMessages } from './Inbox'
import { DIFF_ICON, KINDS } from './queue'
import { Extras, StatusBox } from './StatusBox'

/** What every node of the Outline tab needs: statuses, which nodes are open, the current path, and the user's actions. */
export interface OutlineContext {
    statuses: Statuses
    isOpen: (node: OutlineNode) => boolean
    toggle: (node: OutlineNode) => void
    current: Set<string>
    /** Linked to a session: messages go to it, and the reference button adds to the input box. */
    linked: boolean
    /** Actions the user asked the agent to run, waiting for it to mark them @ran. */
    runs: Record<string, number>
    /** The queue items still waiting for the user, by the node they are about. */
    queued: Map<string, QueueItem>
    onCheck: (node: OutlineNode) => void
    onTopicCheck: (topic: OutlineNode) => void
    onRun: (node: OutlineNode) => void
    onReference: (node: OutlineNode) => void
    /** Nodes changed since the viewer read them: what they read, shown until they open the change. */
    unread: Map<string, NodeContent>
    /** Unread nodes being opened: their diff button is gone, their text animating. */
    opening: Set<string>
    onOpenUnread: (node: OutlineNode) => void
    /** The nodes under a node with a change to open, and opening them all. */
    unreadUnder: (num: string) => string[]
    onOpenUnreadUnder: (node: OutlineNode) => void
    /** The agent's messages about a node or any node under it. */
    messagesFor: (num: string) => Message[]
    seen: Record<string, number>
    onSeen: (ids: string[]) => void
    onReveal: (num: string) => void
}

export const OutlineCtx = createContext<OutlineContext | null>(null)

const useOutlineCtx = () => {
    const ctx = useContext(OutlineCtx)
    if (!ctx) throw new Error('OutlineCtx missing')
    return ctx
}

/** Server HTML: React sets it, and leaves its children alone. */
export function Html({ html, className, hidden }: { html: string; className?: string; hidden?: boolean }) {
    return <div className={className} hidden={hidden} dangerouslySetInnerHTML={{ __html: html }} />
}

/** The node's title, then the tags the page draws for it. */
function Title({ node, titleHtml }: { node: OutlineNode; titleHtml: string }) {
    const { statuses } = useOutlineCtx()
    const group = statuses.isGroup(node)
    return (
        <span className="node-title">
            <span className="title-html" dangerouslySetInnerHTML={{ __html: titleHtml }} />
            {group && (
                <span className="pill pill-pick" title="Choose exactly one of the options below">
                    ◉ Pick one
                </span>
            )}
            {!node.children.length && node.tags.includes('options') && (
                <span className="pill pill-options" title="Options proposed, no recommendation yet">
                    ❓ Options
                </span>
            )}
            {statuses.isOption(node) && node.tags.includes('recommended') && (
                <span className="pill pill-recommended" title="The option the agent recommends">
                    💡 Recommended
                </span>
            )}
            {/* An action the agent ran says so on its Action line; without that line, here. */}
            {(node.tags.includes('ran') || node.tags.includes('failed')) && !node.closing.some(c => c.kind === 'action') && (
                <span dangerouslySetInnerHTML={{ __html: node.tags.includes('ran') ? DONE_PILL : FAILED_PILL }} />
            )}
        </span>
    )
}

/** The red play button of an action: runs it, then waits until the agent marks it done or failed. A failed one can be run again. */
function Play({ node }: { node: OutlineNode }) {
    const { runs, onRun } = useOutlineCtx()
    if (!node.tags.includes('action') || node.tags.includes('ran')) return null
    const sent = !!runs[node.num]
    return (
        <button
            type="button"
            className={cn('play', sent && 'sent')}
            title={sent ? 'Sent: waiting for the agent to run it' : 'Run this action: ask the agent to do it now'}
            aria-label={sent ? 'Waiting for the agent to run it' : 'Run this action'}
            onClick={e => {
                e.stopPropagation()
                if (!sent) onRun(node)
            }}
        >
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
        </button>
    )
}

/** Copies a reference to the node (or, linked to a session, adds it to the input box). */
function Ask({ node }: { node: OutlineNode }) {
    const { linked, onReference } = useOutlineCtx()
    const label = linked ? 'Add a reference to this item to the message box' : 'Copy a reference to paste into the chat'
    return (
        <button
            type="button"
            className="ask"
            title={label}
            aria-label={label}
            onClick={e => {
                e.stopPropagation()
                onReference(node)
            }}
        >
            {linked ? <Reply className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
    )
}

/** A parent's buttons on hover: the reference, and the diff of everything changed under it. */
function Asks({ node }: { node: OutlineNode }) {
    const { unreadUnder, onOpenUnreadUnder } = useOutlineCtx()
    const under = unreadUnder(node.num).length
    return (
        <span className="asks">
            <Ask node={node} />
            {under > 0 && (
                <button
                    type="button"
                    className="ask-diff"
                    data-unread-under={under}
                    title={`${under} change${under === 1 ? '' : 's'} under this node since you read ${under === 1 ? 'it' : 'them'}: click to see all`}
                    aria-label={`See what changed under ${node.num}`}
                    onClick={e => {
                        e.stopPropagation()
                        onOpenUnreadUnder(node)
                    }}
                >
                    {DIFF_ICON}
                </button>
            )}
        </span>
    )
}

/** The diff button of a node changed since the viewer read it: opening it animates the node to its new text. */
function Diff({ node }: { node: OutlineNode }) {
    const { unread, opening, onOpenUnread } = useOutlineCtx()
    if (!unread.has(node.num) || opening.has(node.num)) return null
    return (
        <button
            type="button"
            className="env"
            title="Changed since you read it: click to see what changed"
            aria-label={`See what changed in ${node.num}`}
            onClick={e => {
                e.stopPropagation()
                onOpenUnread(node)
            }}
        >
            {DIFF_ICON}
        </button>
    )
}

/**
 * The icon of the node's queue item, as the left pane shows it, so the item and its node are recognized as one: a red
 * question mark on both, say. It shares the place of the diff button, which comes first (what the node shows is not
 * its text yet); an action's own icon is its play button.
 */
function QueueMark({ node }: { node: OutlineNode }) {
    const { queued, unread, opening } = useOutlineCtx()
    const item = queued.get(node.num)
    if (!item || item.kind === 'action') return null
    if (unread.has(node.num) && !opening.has(node.num)) return null
    const kind = KINDS[item.kind]
    return (
        <span className="qicon" data-queue-kind={item.kind} title={`${kind.name}: ${item.label}`} style={{ color: kind.color }}>
            {kind.icon}
        </span>
    )
}

/** A node's envelope, when the agent has messages about it. */
function Messages({ node }: { node: OutlineNode }) {
    const { messagesFor, seen, onSeen, onReveal } = useOutlineCtx()
    return <NodeMessages num={node.num} messages={messagesFor(node.num)} seen={seen} onSeen={onSeen} onReveal={onReveal} />
}

/** What a node shows: what the viewer read, while the change is unread. */
const useShown = (node: OutlineNode): NodeContent => {
    const { unread } = useOutlineCtx()
    return unread.get(node.num) ?? { titleHtml: node.titleHtml, html: contentHtml(node) }
}

/** Clicks on controls, and text being selected, do not toggle a row. */
const isRowClick = (e: MouseEvent) => !(e.target as Element).closest('input,button,a,.extras') && !String(getSelection()).trim()

export function NodeList({ nodes }: { nodes: OutlineNode[] }) {
    return <div className="nodes">{nodes.map(n => (n.children.length ? <Group key={n.num} node={n} /> : <Leaf key={n.num} node={n} />))}</div>
}

/** A node with children: a header row that sticks while they scroll by, and collapses them. */
function Group({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current, onCheck } = useOutlineCtx()
    const open = isOpen(node)
    const box = statuses.box(node)
    const shown = useShown(node)
    const count = node.children.length
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(node)
        }
    }
    return (
        <div className={cn('group', !open && 'closed')}>
            <div
                className={cn('row parent sticky-head', box.done && 'done', current.has(node.num) && 'current')}
                data-num={node.num}
                data-sticky
                aria-expanded={open}
                onClick={e => isRowClick(e) && toggle(node)}
            >
                <Play node={node} />
                <Diff node={node} />
                <QueueMark node={node} />
                <StatusBox box={box} onToggle={() => onCheck(node)} />
                <ChevronDown className="tri size-4" aria-hidden="true" />
                <span className="num">{node.num}</span>
                <Title node={node} titleHtml={shown.titleHtml} />
                <Asks node={node} />
                <Messages node={node} />
                <span className="kc" role="button" tabIndex={0} title={`${count} direct child${count === 1 ? '' : 'ren'} — click the row to collapse or expand`} onKeyDown={onKey}>
                    <span>{count}</span>
                </span>
                <Extras kinds={box.extras} below={statuses.isOption(node)} />
            </div>
            <div className="kids" hidden={!open}>
                {/* Kept when empty: the diff animation may fill it. */}
                <Html className="group-text node-html" html={shown.html} hidden={!shown.html} />
                <NodeList nodes={node.children} />
            </div>
        </div>
    )
}

/** A node without children: a bubble with its number, title and text. */
function Leaf({ node }: { node: OutlineNode }) {
    const { statuses, current, onCheck } = useOutlineCtx()
    const box = statuses.box(node)
    const shown = useShown(node)
    return (
        <div className={cn('row leaf', box.done && 'done', current.has(node.num) && 'current')} data-num={node.num}>
            <Play node={node} />
            <Diff node={node} />
            <QueueMark node={node} />
            <StatusBox box={box} onToggle={() => onCheck(node)} />
            <span className="num">{node.num}</span>
            <Title node={node} titleHtml={shown.titleHtml} />
            <Ask node={node} />
            <Messages node={node} />
            <Html className="node-html" html={shown.html} />
        </div>
    )
}

/** A topic: a sticky heading over its text and nodes; an approved one starts collapsed. */
export function Topic({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current, onTopicCheck } = useOutlineCtx()
    const open = isOpen(node)
    const box = statuses.topicBox(node)
    const html = contentHtml(node)
    return (
        <section className={cn('topic', !open && 'closed', box.done && 'done')}>
            <div
                className={cn('topic-head sticky-head', current.has(node.num) && 'current')}
                data-num={node.num}
                data-sticky
                aria-expanded={open}
                onClick={e => isRowClick(e) && toggle(node)}
            >
                <QueueMark node={node} />
                <StatusBox box={box} onToggle={() => onTopicCheck(node)} />
                <ChevronDown className="tri size-4" aria-hidden="true" />
                <span className="node-title" dangerouslySetInnerHTML={{ __html: `${node.num}. ${node.titleHtml}` }} />
                <Messages node={node} />
                <Extras kinds={box.extras} />
                <Asks node={node} />
            </div>
            <div className="topic-body" hidden={!open}>
                {html && <Html className="topic-text node-html" html={html} />}
                {node.children.length > 0 && <NodeList nodes={node.children} />}
            </div>
        </section>
    )
}
