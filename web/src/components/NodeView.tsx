import { createContext, useContext, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Statuses } from '@/lib/status'
import type { ClosingLine, OutlineNode } from '@/types'
import { Extras, StatusBox } from './StatusBox'

/** What every node of the Outline tab needs: statuses, which nodes are open, and the current path. */
export interface OutlineContext {
    statuses: Statuses
    isOpen: (node: OutlineNode) => boolean
    toggle: (node: OutlineNode) => void
    current: Set<string>
}

export const OutlineCtx = createContext<OutlineContext | null>(null)

const useOutlineCtx = () => {
    const ctx = useContext(OutlineCtx)
    if (!ctx) throw new Error('OutlineCtx missing')
    return ctx
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>'
const CLOSING_PILL: Record<ClosingLine['kind'], string> = {
    summary: '<span class="pill pill-summary" title="A summary of this node\'s text">Summary</span>',
    recommendation: '<span class="pill pill-recommendation" title="A recommendation for this node">💡 Recommendation</span>',
    action: `<span class="pill pill-action" title="What running this action will do">${PLAY_ICON} Action</span>`,
}

/** A node's text and its closing lines, each after its tag, as one piece of HTML. */
export const contentHtml = (node: OutlineNode) => node.html + node.closing.map(c => `<div class="closing">${CLOSING_PILL[c.kind]} ${c.html}</div>`).join('')

/** Server HTML: React sets it, and leaves its children alone. */
export function Html({ html, className }: { html: string; className?: string }) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

/** The node's title, then the tags the page draws for it. */
function Title({ node }: { node: OutlineNode }) {
    const { statuses } = useOutlineCtx()
    const group = statuses.isGroup(node)
    return (
        <span className="node-title">
            <span dangerouslySetInnerHTML={{ __html: node.titleHtml }} />
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
            {node.tags.includes('ran') && (
                <span className="pill pill-ran" title="The agent carried out this action">
                    Ran
                </span>
            )}
        </span>
    )
}

/** Clicks on controls, and text being selected, do not toggle a row. */
const isRowClick = (e: MouseEvent) => !(e.target as Element).closest('input,button,a,.extras') && !String(getSelection()).trim()

export function NodeList({ nodes }: { nodes: OutlineNode[] }) {
    return <div className="nodes">{nodes.map(n => (n.children.length ? <Group key={n.num} node={n} /> : <Leaf key={n.num} node={n} />))}</div>
}

/** A node with children: a header row that sticks while they scroll by, and collapses them. */
function Group({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current } = useOutlineCtx()
    const open = isOpen(node)
    const box = statuses.box(node)
    const html = contentHtml(node)
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
                <StatusBox box={box} />
                <ChevronDown className="tri size-4" aria-hidden="true" />
                <span className="num">{node.num}</span>
                <Title node={node} />
                <span className="kc" role="button" tabIndex={0} title={`${count} direct child${count === 1 ? '' : 'ren'} — click the row to collapse or expand`} onKeyDown={onKey}>
                    <span>{count}</span>
                </span>
                <Extras kinds={box.extras} below={statuses.isOption(node)} />
            </div>
            <div className="kids" hidden={!open}>
                {html && <Html className="group-text node-html" html={html} />}
                <NodeList nodes={node.children} />
            </div>
        </div>
    )
}

/** A node without children: a bubble with its number, title and text. */
function Leaf({ node }: { node: OutlineNode }) {
    const { statuses, current } = useOutlineCtx()
    const box = statuses.box(node)
    return (
        <div className={cn('row leaf', box.done && 'done', current.has(node.num) && 'current')} data-num={node.num}>
            <StatusBox box={box} />
            <span className="num">{node.num}</span>
            <Title node={node} />
            <Html className="node-html" html={contentHtml(node)} />
        </div>
    )
}

/** A topic: a sticky heading over its text and nodes; an approved one starts collapsed. */
export function Topic({ node }: { node: OutlineNode }) {
    const { statuses, isOpen, toggle, current } = useOutlineCtx()
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
                <StatusBox box={box} />
                <ChevronDown className="tri size-4" aria-hidden="true" />
                <span className="node-title" dangerouslySetInnerHTML={{ __html: `${node.num}. ${node.titleHtml}` }} />
                <Extras kinds={box.extras} />
            </div>
            <div className="topic-body" hidden={!open}>
                {html && <Html className="topic-text node-html" html={html} />}
                {node.children.length > 0 && <NodeList nodes={node.children} />}
            </div>
        </section>
    )
}
