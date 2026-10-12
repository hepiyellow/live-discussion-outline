import type { Mode, OutlineNode } from '@/types'

/**
 * Where a node stands, the agent's side and the user's in one: its status in the file, unless the user changed it on
 * the page and the agent has not recorded that yet (then it is pending); an action the agent has carried out is done,
 * whether or not the user approved it. The page no longer draws this as one tick: it decides what is settled, and so
 * what starts collapsed. What is drawn is a node's kind mark (`Mark`) and its approval box (`BoxState`).
 */
export type Kind = 'open' | 'claim' | 'done' | 'pending' | 'approved'
/**
 * What an approval box shows, the user's side only: nothing, the user's approval (pending while it is on its way to
 * the agent), or, on a parent, mixed: the user approved some of what is under it.
 */
export type BoxState = 'open' | 'pending' | 'approved' | 'mixed'

/** The kinds from lowest to highest: nothing yet, the agent's claim, the user's approval (pending while it is on its way), an action done. */
export const KIND_ORDER: Kind[] = ['open', 'claim', 'pending', 'approved', 'done']

/**
 * A node's kind mark, the agent's side only: a claim (the agent stands behind it, which a question with a recommended
 * option is too), an unresolved question (options, none recommended: the agent needs the user), the same once answered,
 * or an action proposed, done or failed. A node with no stance has none.
 */
export type Mark = 'claim' | 'question' | 'answered' | 'action' | 'done' | 'failed'
/**
 * What a parent's bubbles tell apart, which is what makes a column: a claim the user approved is its own kind, apart
 * from one they have not. The order of `KIND_COLUMNS` is the order the columns are drawn in, left to right: the
 * agent's claims, then its questions, then its actions as they go (proposed, done, failed).
 */
export type KindKey = 'claim' | 'claim-approved' | 'question' | 'answered' | 'action' | 'done' | 'failed'
export const KIND_COLUMNS: KindKey[] = ['claim', 'claim-approved', 'question', 'answered', 'action', 'done', 'failed']
/**
 * How the kind marks at the right of a row are laid out. `indicators-table`: one fixed cell for each kind in view,
 * empty where a row has none, so the marks of different rows line up in columns. `indicators-condensed`: no table, a
 * row draws only the marks it has, together at the right.
 */
export type IndicatorLayout = 'indicators-table' | 'indicators-condensed'
export const INDICATOR_LAYOUT: IndicatorLayout = 'indicators-condensed'
/**
 * Whether the approval box is drawn left of a node's title. Off, it is only hidden: it stays in the row, so the queue
 * icon of an approval still ticks it, and the page's pulses and diff button find it.
 */
export const SHOW_TITLE_CHECKBOX = false
/** The kind mark a column is of. */
export const markOfKey = (key: KindKey): Mark => (key === 'claim-approved' ? 'claim' : key)
export const MARK_TITLE: Record<Mark, string> = {
    claim: 'Claim: the agent stands behind this',
    question: 'Unresolved question: the agent needs your decision',
    answered: 'A question you answered',
    action: 'An action the agent proposes',
    done: 'Done: the agent carried out this action',
    failed: 'Failed: the agent tried this action and could not carry it out',
}

export const KEY_TITLE: Record<KindKey, string> = { ...MARK_TITLE, 'claim-approved': 'Claim: the agent stands behind this, and you approved it' }

/** The tooltip of the box of an action carried out that the user approved. */
const DONE_APPROVED = 'Done: the agent carried out this action, and you approved it'

/** The user's changes the file does not show yet: node number → whether the user wants it approved (or chosen). */
export type Overrides = Record<string, boolean>

/** A kind of mark found under a parent: the nodes that have it, in outline order (the first is where its button goes). */
export interface Extra {
    key: KindKey
    mark: Mark
    nums: string[]
}

/** How a node's or topic's checkbox is drawn. */
export interface Box {
    /** An option of an @options question gets a radio button. */
    shape: 'box' | 'radio'
    state: BoxState
    /** The node's own kind mark, drawn in its kind's column at the right of the row. */
    mark?: Mark
    /** Which column the node's own kind falls in among a parent's bubbles. */
    markKey?: KindKey
    /** Small kind marks beside the row: each one found under a parent, or below an option, other than its own. */
    extras: Extra[]
    title: string
    /** Settled: the row is drawn muted. */
    done: boolean
    /** Server mode: the user changed this node's tick and the agent has not acknowledged it yet, so the box blinks. */
    waiting?: boolean
}

/**
 * The marks of an outline. A row's kind marks are drawn at the right of its title: they say what the node is on the
 * agent's side. Its approval box, which says only whether the user approved it, is drawn at its left. The tick is the
 * user's alone: a claim, or an action the agent carried out, shows an empty box until the user approves it. A parent's
 * box rolls up the approvals under it: ticked when the user approved everything there, mixed when some of it, else
 * empty; the kind marks found under it show beside its own. A question's box is ticked once an option is picked.
 *
 * Apart from what is drawn, each node has a kind (`Kind`) rolled up over its descendants, which says whether anything
 * under a parent is still open: a parent with nothing open is settled, and starts collapsed.
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

    /** A claim of the agent's: its status says so, or it carries a recommendation; the tag stays once the user approved it. */
    private isClaim = (node: OutlineNode) => node.status === 'claim' || node.tags.includes('claim') || node.tags.includes('recommended') || node.closing.some(c => c.kind === 'recommendation')

    /**
     * The node's own kind mark. An action shows as one whatever else the node is. A question is the agent's claim when
     * it recommends an option, and unresolved when it does not, until the user picks. Any other parent has no stance
     * of its own: its status follows what is under it.
     */
    markOf(node: OutlineNode): Mark | undefined {
        if (node.tags.includes('failed')) return 'failed'
        // An action done keeps the mark it had until the viewer opens the change that says so.
        if (this.ran(node)) return this.unread.has(node.num) ? 'action' : 'done'
        if (node.tags.includes('action')) return 'action'
        if (this.isGroup(node)) {
            if (node.children.some(c => c.tags.includes('recommended'))) return 'claim'
            return node.children.some(c => this.effective(c)) ? 'answered' : 'question'
        }
        if (node.children.length && !this.isOption(node)) return undefined
        return this.isClaim(node) ? 'claim' : undefined
    }

    /** Which column a node's kind mark falls in: a claim the user approved has its own. */
    keyOf(node: OutlineNode, mark: Mark): KindKey {
        return mark === 'claim' && this.effective(node) ? 'claim-approved' : mark
    }

    /**
     * The kinds found under a node, each once, in column order: what a collapsed parent holds, with the descendants
     * that have each. `own`, the column of the node's own kind, is left out.
     */
    marksUnder(node: OutlineNode, own?: KindKey): Extra[] {
        const found = new Map<KindKey, string[]>()
        const walk = (n: OutlineNode) => {
            const mark = this.markOf(n)
            if (mark) {
                const key = this.keyOf(n, mark)
                found.set(key, [...(found.get(key) ?? []), n.num])
            }
            n.children.forEach(walk)
        }
        node.children.forEach(walk)
        return KIND_COLUMNS.filter(k => found.has(k) && k !== own).map(key => ({ key, mark: markOfKey(key), nums: found.get(key)! }))
    }

    /** Whether the user approved anything the node holds. */
    private anyApproved(node: OutlineNode): boolean {
        if (!node.children.length || this.isGroup(node)) return this.approvedUnder(node)
        return node.children.some(c => this.anyApproved(c)) || (this.ran(node) && this.effective(node))
    }

    /** A parent's box, from the approvals under it: all of them, some, or none; pending while one is on its way. */
    private rolled(all: boolean, any: boolean, kinds: Kind[]): BoxState {
        if (all) return kinds.includes('pending') ? 'pending' : 'approved'
        return any ? 'mixed' : 'open'
    }

    /** The tooltip of a parent's box. */
    private rolledTitle(state: BoxState, node: OutlineNode, topic = false) {
        if (!topic && this.isGroup(node)) {
            if (state === 'approved') return 'Answered: you picked an option'
            if (state === 'pending') return 'Chosen — pending until the agent has taken it in'
            return node.children.some(c => c.tags.includes('recommended')) ? 'Not answered — click to choose the recommended option' : 'Not answered: pick one of the options below'
        }
        if (state === 'approved') return 'User-approved: you approved everything under it'
        if (state === 'pending') return 'User-approved — pending until the agent has taken it in'
        return state === 'mixed' ? 'You approved some of what is under it — click to approve all' : 'Nothing under it is approved — click to approve all'
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
        const mark = this.markOf(node)
        const markKey = mark && this.keyOf(node, mark)
        if (node.children.length && !option) {
            const state = this.rolled(this.approvedUnder(node), this.anyApproved(node), kinds)
            return { shape: 'box', state, mark, markKey, extras: this.marksUnder(node, markKey), title: this.rolledTitle(state, node), done: this.approvedUnder(node) && !kinds.includes('pending') }
        }
        const file = this.fileDone(node)
        const on = this.effective(node)
        const pendingOn = on && !file
        const pendingOff = !on && file
        const siblings = this.parent(node)?.children ?? []
        const outvoted = option && !on && siblings.some(s => s !== node && this.effective(s))
        const agent = this.isClaim(node) && !outvoted
        // Recorded at once in server mode, and pending all the same until the agent acknowledges it.
        const waiting = this.unacked.has(node.num)
        // The tick is the user's approval and nothing else: a claim, or an action carried out, has an empty box until then.
        const state: BoxState = !on ? 'open' : pendingOn || waiting ? 'pending' : 'approved'
        const ranHere = this.ran(node) && !this.unread.has(node.num)
        const approve = this.mode === 'server' ? 'click to approve it' : 'click to queue your approval'
        const title = waiting
            ? `${option ? (on ? 'Chosen' : 'No longer chosen') : on ? 'User-approved' : 'Approval taken back'} — pending until the agent acknowledges it`
            : option
              ? pendingOn
                  ? 'Pending choice — it stops fading once the agent records it'
                  : pendingOff
                    ? 'Pending un-choose — cleared once the agent records it'
                    : on
                      ? 'Chosen'
                      : agent
                        ? 'Recommended — click to choose it'
                        : 'Choose this option'
              : pendingOn
                ? 'Pending approval — it stops fading once the agent records it'
                : pendingOff
                  ? 'Pending reopen — cleared once the agent records it'
                  : ranHere
                    ? on
                        ? DONE_APPROVED
                        : `Done: the agent carried out this action — ${approve}`
                    : on
                      ? 'User-approved'
                      : agent
                        ? `Claim — ${approve}`
                        : 'Approve this node'
        const parent = this.parent(node)
        // An answered question's options are settled, the unpicked ones too.
        const answered = option && !!parent && parent.children.some(c => this.fileDone(c) && this.effective(c) && !this.unacked.has(c.num))
        const done = (on && file && (!node.children.length || this.approvedUnder(node))) || answered
        // An option's radio is its own pick; the kind marks below it show small beside it.
        return { shape: option ? 'radio' : 'box', state, mark, markKey, extras: node.children.length ? this.marksUnder(node, markKey) : [], title, done, waiting }
    }

    /** A topic's box rolls up every node under it; a topic with none shows its own approval. */
    topicBox(topic: OutlineNode): Box {
        if (!topic.children.length || this.isGroup(topic)) return { ...this.box(topic), shape: 'box' }
        const seen = new Set(topic.children.flatMap(c => this.kindsOf(c)))
        const kinds = KIND_ORDER.filter(k => seen.has(k))
        const all = topic.children.every(c => this.approvedUnder(c))
        const state = this.rolled(all, topic.children.some(c => this.anyApproved(c)), kinds)
        const mark = this.markOf(topic)
        const markKey = mark && this.keyOf(topic, mark)
        return { shape: 'box', state, mark, markKey, extras: this.marksUnder(topic, markKey), title: this.rolledTitle(state, topic, true), done: all && !kinds.includes('pending') }
    }
}

/**
 * The columns the kind marks are drawn in, for the rows in view: the kinds that some row in view shows (its own, and on
 * a parent those found under it), in column order. A row is in view when every parent above it is open, so the nodes
 * under a collapsed parent are not rows of the view; what they are is in the bubbles of the parent that stands for them.
 */
export function kindColumnsInView(nodes: OutlineNode[], statuses: Statuses, isOpen: (node: OutlineNode) => boolean): KindKey[] {
    const found = new Set<KindKey>()
    const walk = (list: OutlineNode[], topic: boolean) => {
        for (const n of list) {
            const box = topic ? statuses.topicBox(n) : statuses.box(n)
            if (box.markKey) found.add(box.markKey)
            for (const e of box.extras) found.add(e.key)
            if (isOpen(n)) walk(n.children, false)
        }
    }
    walk(nodes, true)
    return KIND_COLUMNS.filter(k => found.has(k))
}

/**
 * What changed in a node's kind marks: the columns that gained a mark or whose count changed (they pulse), and what
 * went: the count a column had. What went is drawn until the pulse ends. A node's own mark that moved to another
 * column is not drawn twice: the new one pulses.
 */
export interface MarksChange {
    keys: Set<KindKey>
    gone: Partial<Record<KindKey, number>>
}

/** The nodes whose kind marks differ between two statuses of one outline, with what differs. */
export function marksChanged(before: Statuses, after: Statuses, nodes: OutlineNode[]): Map<string, MarksChange> {
    const changes = new Map<string, MarksChange>()
    const walk = (list: OutlineNode[], topic: boolean) => {
        for (const n of list) {
            const was = topic ? before.topicBox(n) : before.box(n)
            const now = topic ? after.topicBox(n) : after.box(n)
            const change: MarksChange = { keys: new Set(), gone: {} }
            if (was.markKey !== now.markKey && now.markKey) change.keys.add(now.markKey)
            const counts = (box: Box) => new Map(box.extras.map(e => [e.key, e.nums.length]))
            const from = counts(was)
            const to = counts(now)
            for (const key of new Set([...from.keys(), ...to.keys()])) {
                const had = from.get(key) ?? 0
                const has = to.get(key) ?? 0
                if (had === has) continue
                if (has) change.keys.add(key)
                else change.gone[key] = had
            }
            if (change.keys.size || Object.keys(change.gone).length) changes.set(n.num, change)
            walk(n.children, false)
        }
    }
    walk(nodes, true)
    return changes
}
