import { createContext, useContext, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, Copy, History, Reply, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Statuses } from '@/lib/status'
import { DONE_PILL, FAILED_PILL, liveHtml, type NodeContent } from '@/lib/content'
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
    runs: Record<string, number | string>
    /** The queue items still waiting for the user, by the node they are about. */
    queued: Map<string, QueueItem>
    onCheck: (node: OutlineNode) => void
    onTopicCheck: (topic: OutlineNode) => void
    onRun: (node: OutlineNode) => void
    onReference: (node: OutlineNode) => void
    /** The trash button: asks the agent to take the node out of the outline, once the user has said why. */
    onRemove: (node: OutlineNode) => void
    /** Opens the node's history: its changes, and the node as it was at each. */
    onHistory: (node: OutlineNode) => void
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

/** Scrolls to the button in a node's text that runs its action, and pulses it, once the node has opened. */
function pointAtRun(num: string) {
    setTimeout(() => {
        const button = document.querySelector(`.outline-tab [data-text-of="${CSS.escape(num)}"] [data-run]`)
        if (!button) return
        button.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        button.setAttribute('data-pulse', '')
        setTimeout(() => button.removeAttribute('data-pulse'), 1700)
    }, 0)
}

/**
 * The red triangle of an action still to run. It runs nothing itself: a click opens the node and points at the button
 * in its text that does, as the diff button leads to the diff.
 */
function Play({ node }: { node: OutlineNode }) {
    const { isOpen, toggle, runs } = useOutlineCtx()
    if (!node.tags.includes('action') || node.tags.includes('ran')) return null
    // From the click on Run until the agent marks the action done or failed, a ring turns in place of the triangle.
    const running = !!runs[node.num]
    return (
        <button
            type="button"
            className={cn('play', running && 'running')}
            title={running ? 'Running: waiting for the agent to finish it' : 'An action: click to see the button that runs it'}
            aria-label={running ? `${node.num} is running` : `Show the button that runs ${node.num}`}
            onClick={e => {
                e.stopPropagation()
                if (!isOpen(node)) toggle(node)
                pointAtRun(node.num)
            }}
        >
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
        </button>
    )
}

/** Makes a checkbox grow and shrink three times, ringed in green: this is where to click. */
function pulseBox(box: HTMLElement) {
    box.removeAttribute('data-pulse')
    void box.offsetWidth
    box.setAttribute('data-pulse', '')
}

/** Shows the option's own checkbox and pulses it: the action's button waits for it to be picked. */
function pointAtBox(num: string) {
    const box = document.querySelector<HTMLElement>(`.outline-tab [data-num="${CSS.escape(num)}"] > .ck`)
    if (!box) return
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    pulseBox(box)
}

/**
 * A node's text. The Action button in it runs the action, then shows a turning ring until the agent marks the action
 * done or failed. A failed one can be run again.
 */
function NodeText({ node, html, className, hidden }: { node: OutlineNode; html: string; className: string; hidden?: boolean }) {
    const { runs, onRun, statuses } = useOutlineCtx()
    const sent = !!runs[node.num]
    // An option's action waits for its option to be picked: until then its Run button is off.
    const unpicked = statuses.isOption(node) && !['approved', 'pending'].includes(statuses.box(node).state)
    const root = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        for (const button of root.current?.querySelectorAll<HTMLButtonElement>('[data-run]') ?? []) {
            // Looks off but takes the click: it points at the option's checkbox, which is what to do first.
            button.toggleAttribute('data-off', unpicked)
            button.setAttribute('aria-disabled', String(unpicked))
            // The button's own title comes back once its option is picked.
            button.dataset.title ??= button.title
            button.title = unpicked ? 'Pick this option first: click to see its checkbox' : button.dataset.title
        }
    }, [html, unpicked])
    return (
        <div
            ref={root}
            className={className}
            hidden={hidden}
            data-text-of={node.num}
            data-run-sent={sent || undefined}
            data-run-off={unpicked || undefined}
            onClick={e => {
                if (!(e.target as Element).closest('[data-run]')) return
                e.stopPropagation()
                if (unpicked) return pointAtBox(node.num)
                if (!sent) onRun(node)
            }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
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

/** The node's history, on hover: its changes, with the node as it was at each. */
function HistoryButton({ node }: { node: OutlineNode }) {
    const { onHistory } = useOutlineCtx()
    return (
        <button
            type="button"
            className="ask"
            title="History: the changes to this node"
            aria-label={`History of ${node.num}`}
            onClick={e => {
                e.stopPropagation()
                onHistory(node)
            }}
        >
            <History className="size-3.5" />
        </button>
    )
}

/** Asks to take the node out of the outline, on hover: linked to a session, it waits in the input box for the user's reason. */
function RemoveButton({ node }: { node: OutlineNode }) {
    const { linked, onRemove } = useOutlineCtx()
    const label = linked ? 'Remove this item: adds it to the message box, for you to say why' : 'Remove this item: copies the request to paste into the chat'
    return (
        <button
            type="button"
            className="ask"
            data-remove
            title={label}
            aria-label={`Remove ${node.num}`}
            onClick={e => {
                e.stopPropagation()
                onRemove(node)
            }}
        >
            <Trash2 className="size-3.5" />
        </button>
    )
}

/** A parent's buttons on hover: the reference, the history, the trash, and the diff of everything changed under it. */
function Asks({ node }: { node: OutlineNode }) {
    const { unreadUnder, onOpenUnreadUnder } = useOutlineCtx()
    const under = unreadUnder(node.num).length
    return (
        <span className="asks">
            <Ask node={node} />
            <HistoryButton node={node} />
            <RemoveButton node={node} />
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
            // The new content has the agent's Done tag: the change is an action carried out, which the icon shows in yellow.
            data-done={node.tags.includes('ran') || undefined}
            title={node.tags.includes('ran') ? 'Changed since you read it, and now done: click to see what changed' : 'Changed since you read it: click to see what changed'}
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
 * The icon of the node's queue item, as the queue column shows it, so the item and its node are recognized as one: a red
 * question mark on both, say. It shares the place of the diff button, which comes first (what the node shows is not
 * its text yet); an action's own icon is its play button.
 */
function QueueMark({ node }: { node: OutlineNode }) {
    const { queued, unread, opening } = useOutlineCtx()
    const item = queued.get(node.num)
    if (!item || item.kind === 'action') return null
    if (unread.has(node.num) && !opening.has(node.num)) return null
    const kind = KINDS[item.kind]
    // The icon neither scrolls nor toggles the row. Of an item to approve it points at the node's own checkbox, which is
    // where the approving is done: that box pulses.
    const point = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        if (item.kind !== 'approve') return
        const box = e.currentTarget.parentElement?.querySelector<HTMLElement>(':scope > .ck')
        if (box) pulseBox(box)
    }
    return (
        <button
            type="button"
            className="qicon"
            data-queue-kind={item.kind}
            title={item.kind === 'approve' ? `${kind.name}: ${item.label} — tick the checkbox to approve it` : `${kind.name}: ${item.label}`}
            aria-label={`${kind.name}: ${item.label}`}
            style={{ color: kind.color }}
            onClick={point}
        >
            {kind.icon}
        </button>
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
    return unread.get(node.num) ?? { titleHtml: node.titleHtml, html: liveHtml(node) }
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
                <NodeText node={node} className="group-text node-html" html={shown.html} hidden={!shown.html} />
                <NodeList nodes={node.children} />
            </div>
        </div>
    )
}

/** A node without children: a title row with its number and title, and its text below, which an approved or done node starts with hidden. */
function Leaf({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current, onCheck } = useOutlineCtx()
    const box = statuses.box(node)
    const shown = useShown(node)
    const open = isOpen(node)
    // Only a node with text has something to hide.
    const text = !!shown.html
    return (
        <div
            className={cn('row leaf', text && 'has-text', text && !open && 'closed', box.done && 'done', current.has(node.num) && 'current')}
            data-num={node.num}
            aria-expanded={text ? open : undefined}
            onClick={e => text && isRowClick(e) && toggle(node)}
        >
            <Play node={node} />
            <Diff node={node} />
            <QueueMark node={node} />
            <StatusBox box={box} onToggle={() => onCheck(node)} />
            {text && <ChevronDown className="tri size-4" aria-hidden="true" />}
            <span className="num">{node.num}</span>
            <Title node={node} titleHtml={shown.titleHtml} />
            <span className="asks">
                <Ask node={node} />
                <HistoryButton node={node} />
                <RemoveButton node={node} />
            </span>
            <Messages node={node} />
            <NodeText node={node} className="node-html" html={shown.html} hidden={!open} />
        </div>
    )
}

/** A topic: a sticky heading over its text and nodes; an approved one starts collapsed. */
export function Topic({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current, onTopicCheck } = useOutlineCtx()
    const open = isOpen(node)
    const box = statuses.topicBox(node)
    const html = liveHtml(node)
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
                {html && <NodeText node={node} className="topic-text node-html" html={html} />}
                {node.children.length > 0 && <NodeList nodes={node.children} />}
            </div>
        </section>
    )
}
