import type { Mode, OutlineNode } from '@/types'

/**
 * What a checkbox shows. A node's own kind is its status in the file, unless the user changed it on the page and the
 * agent has not recorded that yet: then it is pending. An action the agent has carried out is done, whether or not the
 * user approved it: done supersedes approved.
 */
export type Kind = 'open' | 'claim' | 'done' | 'pending' | 'approved'
/** A parent with something open under it, beside other kinds, shows `mixed`, with each kind beside it. */
export type BoxState = Kind | 'mixed'

/**
 * The kinds in the order a parent lists them, which is also lowest to highest: nothing yet, the agent's claim, the
 * user's approval (pending while it is on its way), an action done.
 */
export const KIND_ORDER: Kind[] = ['open', 'claim', 'pending', 'approved', 'done']
export const KIND_TITLE: Record<Kind, string> = { open: 'Open', claim: 'Claim', done: 'Done by the agent', pending: 'Pending: you approved it, and the agent has not recorded that yet', approved: 'User-approved' }

/** The tooltip of an action carried out that the user approved: its tick is the done one, and this tells the two apart. */
const DONE_APPROVED = 'Done: the agent carried out this action, and you approved it'

/** The user's changes the file does not show yet: node number → whether the user wants it approved (or chosen). */
export type Overrides = Record<string, boolean>

/** How a node's or topic's checkbox is drawn. */
export interface Box {
    /** An option of an @options question gets a radio button. */
    shape: 'box' | 'radio'
    state: BoxState
    /** Small icons beside the box: each kind found under a parent whose descendants differ, or below an option. */
    extras: Kind[]
    title: string
    /** Settled: the row is drawn muted. */
    done: boolean
    /** Server mode: the user changed this node's tick and the agent has not acknowledged it yet, so the box blinks. */
    waiting?: boolean
}

/**
 * The checkboxes of an outline: each node's own kind, rolled up over its descendants. A parent shows the set of its
 * descendants' kinds. When they agree it shows that kind. When they differ and none is open, everything under it is
 * settled, and it shows the highest of them (a claim, then the user's approval, then an action done) with each kind
 * beside it; with something open among them it shows a mixed box, with each kind beside it. An @options question takes
 * the kind of its picked option, else of its recommended one.
 *
 * What the user approved is a separate question from what a box shows, since a done tick may or may not stand over an
 * approval: `effective` and `approvedUnder` answer it, and a click goes by them.
 */
export class Statuses {
    private parents = new Map<string, OutlineNode | undefined>()
    private kinds = new Map<string, Kind[]>()

    constructor(
        readonly nodes: OutlineNode[],
        readonly overrides: Overrides = {},
        /** In server mode a tick is recorded at once, so a box does not say it queues one. */
        readonly mode: Mode = 'file',
        /** Server mode: the nodes whose tick the user changed and the agent has not acknowledged yet. */
        readonly unacked: ReadonlySet<string> = new Set(),
        /**
         * The nodes whose change the viewer has not opened yet: an action done there keeps the tick it showed until
         * they do. Its parents do not wait: they count it as done from the moment it arrives.
         */
        readonly unread: ReadonlySet<string> = new Set(),
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
        // The user's tick on its way to the agent shows as such, whatever it stands on.
        if (on && (!file || this.unacked.has(node.num))) return 'pending'
        if (this.ran(node)) return 'done'
        if (on) return 'approved'
        return node.status === 'claim' ? 'claim' : 'open'
    }

    /** The kinds a node shows: its own for a leaf, else the set of its descendants' kinds in KIND_ORDER. */
    kindsOf(node: OutlineNode): Kind[] {
        const cached = this.kinds.get(node.num)
        if (cached) return cached
        let kinds: Kind[]
        if (!node.children.length) kinds = [this.ownKind(node)]
        else if (this.isGroup(node)) {
            // A question is its picked option; unanswered, it is the agent's claim when it recommends one.
            const picked = node.children.find(c => this.effective(c))
            const seen = new Set(node.children.flatMap(c => this.kindsOf(c)))
            kinds = [picked ? this.ownKind(picked) : seen.has('claim') ? 'claim' : seen.has('done') ? 'done' : 'open']
        } else {
            const seen = new Set(node.children.flatMap(c => this.kindsOf(c)))
            // A parent the agent carried out as an action shows its own done tick among its descendants' kinds.
            if (this.ownKind(node) === 'done') seen.add('done')
            kinds = KIND_ORDER.filter(k => seen.has(k))
        }
        this.kinds.set(node.num, kinds)
        return kinds
    }

    /**
     * What a parent's box shows for the kinds under it: the one kind they share; with something open among others,
     * mixed; else the highest of them, since everything under it is settled.
     */
    static aggregate(kinds: Kind[]): BoxState {
        if (kinds.length === 1) return kinds[0]
        if (kinds.includes('open')) return 'mixed'
        const highest = kinds[kinds.length - 1]
        // An approval on its way shows as such on the parent too, unless something done stands above it.
        return highest === 'approved' && kinds.includes('pending') ? 'pending' : highest
    }

    /** The kinds to list beside a parent's box: each one, when they differ by more than an approval being on its way. */
    private static beside = (kinds: Kind[]) => (kinds.length > 1 && !kinds.every(k => k === 'approved' || k === 'pending') ? kinds : [])

    /** The tooltip of a parent's box. */
    private static rolledTitle(state: BoxState, kinds: Kind[]) {
        const list = kinds.map(k => KIND_TITLE[k].toLowerCase()).join(', ')
        if (state === 'mixed') return `Mixed: children are ${list} — click to approve all`
        return Statuses.beside(kinds).length ? `Settled, at most ${KIND_TITLE[state].toLowerCase()}: children are ${list} — click to approve all` : KIND_TITLE[state]
    }

    /**
     * Whether the user approved everything the node holds: a leaf by its own tick, a question by a picked option, a
     * parent by every node under it (and by its own tick, when it is itself an action the agent carried out).
     */
    approvedUnder(node: OutlineNode): boolean {
        if (!node.children.length) return this.effective(node)
        if (this.isGroup(node)) return node.children.some(c => this.effective(c))
        return node.children.every(c => this.approvedUnder(c)) && (!this.ran(node) || this.effective(node))
    }

    /**
     * Whether nothing the node holds is open: every node under it is a claim, approved or done, and a question among
     * them is answered or has a recommendation. Such a parent collapses. A question itself is settled once an option
     * is picked, whatever its other options show.
     */
    isSettled(node: OutlineNode) {
        if (!node.children.length) return false
        if (this.isGroup(node)) return node.children.some(c => this.effective(c))
        return !node.children.flatMap(c => this.kindsOf(c)).includes('open')
    }

    /**
     * Whether a node starts open; the viewer's own choices override it. A parent starts collapsed once it is settled;
     * a node without children, once the user approved it or the agent carried it out.
     */
    startsOpen(node: OutlineNode) {
        return node.children.length ? !this.isSettled(node) : node.status !== 'approved' && !node.tags.includes('ran')
    }

    box(node: OutlineNode): Box {
        const option = this.isOption(node)
        const kinds = this.kindsOf(node)
        if (node.children.length && !option) {
            const state = Statuses.aggregate(kinds)
            return { shape: 'box', state, extras: Statuses.beside(kinds), title: Statuses.rolledTitle(state, kinds), done: this.approvedUnder(node) && !kinds.includes('pending') }
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
        // Recorded at once in server mode, and pending all the same until the agent acknowledges it.
        const waiting = this.unacked.has(node.num)
        // An action carried out shows a yellow outlined tick, approved or not: done supersedes approved. A click on one
        // not approved turns it into the user's approval, which is pending until the agent has it, and then done again.
        const ranHere = this.ran(node) && !this.unread.has(node.num) && !(node.num in this.overrides) && !(waiting && fromFile === 'approved')
        const state: Kind = ranHere ? 'done' : waiting && fromFile === 'approved' ? 'pending' : fromFile
        const approve = this.mode === 'server' ? 'click to approve it' : 'click to queue your approval'
        const title = waiting
            ? `${option ? (on ? 'Chosen' : 'No longer chosen') : on ? 'User-approved' : 'Approval taken back'} — pending until the agent acknowledges it`
            : ranHere
            ? fromFile === 'approved'
                ? DONE_APPROVED
                : `Done: the agent carried out this action — ${approve}`
            : option
            ? pendingOn
                ? 'Pending choice — it stops fading once the agent records it'
                : pendingOff
                  ? 'Pending un-choose — cleared once the agent records it'
                  : agent
                    ? 'Recommended — click to choose it'
                    : on
                      ? 'Chosen'
                      : 'Choose this option'
            : pendingOn
              ? 'Pending approval — it stops fading once the agent records it'
              : pendingOff
                ? 'Pending reopen — cleared once the agent records it'
                : agent
                  ? `Claim — ${approve}`
                  : on
                    ? 'User-approved'
                    : 'Approve this node'
        // An option's radio is its own pick; the kinds below it show as small marks beside it.
        const extras = node.children.length ? kinds.filter(k => k !== this.ownKind(node)) : []
        const parent = this.parent(node)
        // An answered question's options are settled, the unpicked ones too.
        const answered = option && !!parent && parent.children.some(c => this.fileDone(c) && this.effective(c) && !this.unacked.has(c.num))
        const done = (on && file && (!node.children.length || this.approvedUnder(node))) || answered
        return { shape: option ? 'radio' : 'box', state, extras, title, done, waiting }
    }

    /** A topic's box rolls up every node under it; a topic with none shows its own status. */
    topicBox(topic: OutlineNode): Box {
        if (!topic.children.length) return { ...this.box(topic), shape: 'box' }
        const seen = new Set(topic.children.flatMap(c => this.kindsOf(c)))
        const kinds = KIND_ORDER.filter(k => seen.has(k))
        const state = Statuses.aggregate(kinds)
        return { shape: 'box', state, extras: Statuses.beside(kinds), title: Statuses.rolledTitle(state, kinds).replace('children are ', ''), done: topic.children.every(c => this.approvedUnder(c)) && !kinds.includes('pending') }
    }
}
