import type { OutlineNode } from '@/types'

/**
 * What a checkbox shows. A node's own kind is its status in the file, unless the user changed it on the page and the
 * agent has not recorded that yet: then it is pending. An action the agent has carried out, and the user has not
 * approved, is done.
 */
export type Kind = 'open' | 'claim' | 'done' | 'pending' | 'approved'
/** A parent whose descendants differ shows `mixed`, with each of their kinds beside it. */
export type BoxState = Kind | 'mixed'

export const KIND_ORDER: Kind[] = ['open', 'claim', 'done', 'pending', 'approved']
export const KIND_TITLE: Record<Kind, string> = { open: 'Open', claim: 'Claim', done: 'Done by the agent', pending: 'Pending: you approved it, and the agent has not recorded that yet', approved: 'User-approved' }

/** The user's changes the file does not show yet: node number → whether the user wants it approved (or chosen). */
export type Overrides = Record<string, boolean>

/** How a node's or topic's checkbox is drawn. */
export interface Box {
    /** An option of an @options question gets a radio button. */
    shape: 'box' | 'radio'
    state: BoxState
    /** Small icons beside the box: the kinds below a mixed parent, or below an option. */
    extras: Kind[]
    title: string
    /** Settled: the row is drawn muted. */
    done: boolean
}

/**
 * The checkboxes of an outline: each node's own kind, rolled up over its descendants. A parent shows the set of its
 * descendants' kinds: one icon when they agree, else a mixed box with each kind beside it. An @options question takes
 * the kind of its picked option, else of its recommended one.
 */
export class Statuses {
    private parents = new Map<string, OutlineNode | undefined>()
    private kinds = new Map<string, Kind[]>()

    constructor(
        readonly nodes: OutlineNode[],
        readonly overrides: Overrides = {},
    ) {
        const index = (list: OutlineNode[], parent?: OutlineNode) =>
            list.forEach(n => {
                this.parents.set(n.num, parent)
                index(n.children, n)
            })
        index(nodes)
    }

    parent = (node: OutlineNode) => this.parents.get(node.num)
    fileDone = (node: OutlineNode) => node.status === 'approved'
    /** An action the agent has carried out. */
    ran = (node: OutlineNode) => node.tags.includes('ran')
    /** Whether the node counts as approved, the user's unrecorded change included. */
    effective = (node: OutlineNode) => (node.num in this.overrides ? this.overrides[node.num] : this.fileDone(node))
    /**
     * A question with its options under it. `@options` says so, but a node whose children carry option letters
     * (`@option_A`) is one too: an agent that records the user's pick sometimes drops `@options`, and the pick is still
     * a pick of one.
     */
    isGroup = (node: OutlineNode) => node.children.length > 0 && (node.tags.includes('options') || node.children.some(c => !!c.option))
    isOption = (node: OutlineNode) => {
        const parent = this.parent(node)
        return !!parent && this.isGroup(parent)
    }

    ownKind(node: OutlineNode): Kind {
        const file = this.fileDone(node)
        const on = this.effective(node)
        if (on && !file) return 'pending'
        if (on && file) return 'approved'
        if (this.ran(node)) return 'done'
        return node.status === 'claim' ? 'claim' : 'open'
    }

    /** The kinds a node shows: its own for a leaf, else the set of its descendants' kinds in KIND_ORDER. */
    kindsOf(node: OutlineNode): Kind[] {
        const cached = this.kinds.get(node.num)
        if (cached) return cached
        let kinds: Kind[]
        if (!node.children.length) kinds = [this.ownKind(node)]
        else {
            const seen = new Set(node.children.flatMap(c => this.kindsOf(c)))
            // A parent the agent carried out as an action shows its own done tick among its descendants' kinds.
            if (this.ownKind(node) === 'done' && !this.isGroup(node)) seen.add('done')
            kinds = this.isGroup(node) ? [(['approved', 'pending', 'claim', 'done'] as Kind[]).find(k => seen.has(k)) ?? 'open'] : KIND_ORDER.filter(k => seen.has(k))
        }
        this.kinds.set(node.num, kinds)
        return kinds
    }

    /** All approved (some maybe still pending) reads as pending or approved; differing kinds are mixed. */
    static aggregate(kinds: Kind[]): BoxState {
        if (kinds.every(k => k === 'approved' || k === 'pending')) return kinds.includes('pending') ? 'pending' : 'approved'
        return kinds.length > 1 ? 'mixed' : kinds[0]
    }

    /** Whether every descendant is approved or pending: completing a parent collapses it. */
    isComplete(node: OutlineNode) {
        // A question is complete once an option is picked, whatever the others show.
        const kinds = !node.children.length ? [] : this.isGroup(node) ? this.kindsOf(node) : node.children.flatMap(c => this.kindsOf(c))
        return kinds.length > 0 && kinds.every(k => k === 'approved' || k === 'pending')
    }

    box(node: OutlineNode): Box {
        const option = this.isOption(node)
        const kinds = this.kindsOf(node)
        if (node.children.length && !option) {
            const state = Statuses.aggregate(kinds)
            const title =
                state === 'mixed' ? `Mixed: children are ${kinds.map(k => KIND_TITLE[k].toLowerCase()).join(', ')} — click to approve all` : KIND_TITLE[state]
            return { shape: 'box', state, extras: state === 'mixed' ? kinds : [], title, done: kinds.length === 1 && kinds[0] === 'approved' }
        }
        const file = this.fileDone(node)
        const on = this.effective(node)
        const pendingOn = on && !file
        const pendingOff = !on && file
        const siblings = this.parent(node)?.children ?? []
        const outvoted = option && !on && siblings.some(s => s !== node && this.effective(s))
        const agent = node.status === 'claim' && !outvoted
        const checked = on || (agent && !(node.num in this.overrides))
        const fromFile: Kind = !checked ? 'open' : pendingOn ? 'pending' : agent && !pendingOff ? 'claim' : 'approved'
        // Done until the user says otherwise: a filled yellow tick, which a click turns into their approval.
        const ranHere = this.ran(node) && (fromFile === 'open' || fromFile === 'claim') && !(node.num in this.overrides)
        const state: Kind = ranHere ? 'done' : fromFile
        const title = ranHere
            ? 'Done: the agent carried out this action — click to queue your approval'
            : option
            ? pendingOn
                ? 'Pending choice — filled once the agent records it'
                : pendingOff
                  ? 'Pending un-choose — cleared once the agent records it'
                  : agent
                    ? 'Recommended — click to choose it'
                    : on
                      ? 'Chosen'
                      : 'Choose this option'
            : pendingOn
              ? 'Pending approval — filled once the agent records it'
              : pendingOff
                ? 'Pending reopen — cleared once the agent records it'
                : agent
                  ? 'Claim — click to queue your approval'
                  : on
                    ? 'User-approved'
                    : 'Approve this node'
        // An option's radio is its own pick; the kinds below it show as small marks beside it.
        const extras = node.children.length ? kinds.filter(k => k !== this.ownKind(node)) : []
        const parent = this.parent(node)
        const done = (on && file && (!node.children.length || kinds.every(k => k === 'approved'))) || (option && !!parent && this.kindsOf(parent)[0] === 'approved')
        return { shape: option ? 'radio' : 'box', state, extras, title, done }
    }

    /** A topic's box rolls up every node under it; a topic with none shows its own status. */
    topicBox(topic: OutlineNode): Box {
        if (!topic.children.length) return { ...this.box(topic), shape: 'box' }
        const seen = new Set(topic.children.flatMap(c => this.kindsOf(c)))
        const kinds = KIND_ORDER.filter(k => seen.has(k))
        const state = Statuses.aggregate(kinds)
        const title = state === 'mixed' ? `Mixed: ${kinds.map(k => KIND_TITLE[k].toLowerCase()).join(', ')} — click to approve all` : KIND_TITLE[state]
        return { shape: 'box', state, extras: state === 'mixed' ? kinds : [], title, done: state === 'approved' }
    }
}
