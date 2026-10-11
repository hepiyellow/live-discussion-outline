import { allNodes, stillRunning } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import type { Outline, OutlineNode, StatePatch, UndoStep, ViewerState } from '@/types'

// The user's approvals, picks and undos in server mode. A click works out which nodes' ticks change; the page sends
// those to the server, which records them in the outline at once (POST /api/outline/<project>/<file>/act) and tells the
// agent. File mode's are in fileApprovals.ts.

/** What a click changes: node number → whether the user wants it approved (or chosen), for the nodes that differ from the outline. */
export interface Draft {
    overrides: Record<string, boolean>
}

export const emptyDraft = (): Draft => ({ overrides: {} })

/** A node's tick as the server takes it. */
export interface Tick {
    num: string
    approved: boolean
}

export const ticksOf = (draft: Draft): Tick[] => Object.entries(draft.overrides).map(([num, approved]) => ({ num, approved }))

/** Applies a click to a draft. */
export class Approvals {
    constructor(
        readonly outline: Outline,
        readonly draft: Draft,
    ) {}

    statuses = () => new Statuses(this.outline.nodes, this.draft.overrides)
    fileDone = (node: OutlineNode) => node.status === 'approved'

    /** Sets what the user wants for one node. */
    setWant(node: OutlineNode, want: boolean) {
        if (want === this.fileDone(node)) delete this.draft.overrides[node.num]
        else this.draft.overrides[node.num] = want
    }

    /** Picks an option: it is chosen, and its siblings are not. */
    choose(node: OutlineNode) {
        this.setWant(node, true)
        for (const s of this.statuses().parent(node)?.children ?? []) if (s !== node) this.setWant(s, false)
    }

    /**
     * A click on a node's checkbox (or radio). It goes by what the user approved, not by the tick drawn: a claim, an
     * action the agent has done and a settled parent all show a tick, and a click on one gives the user's approval
     * rather than clearing it. A click on what the user approved takes the approval back.
     */
    clickNode(node: OutlineNode) {
        const st = this.statuses()
        if (st.isGroup(node)) {
            const pick = node.children.find(c => c.tags.includes('recommended'))
            if (node.children.some(c => st.effective(c))) node.children.forEach(c => this.setWant(c, false))
            else if (pick) this.choose(pick)
            return
        }
        if (st.isOption(node)) {
            if (st.effective(node)) this.setWant(node, false)
            else this.choose(node)
            return
        }
        const want = !st.approvedUnder(node)
        for (const n of allNodes([node])) this.setWant(n, want)
    }

    /** A click on a topic's checkbox: approves (or reopens) every node under it, options and questions aside. */
    clickTopic(topic: OutlineNode) {
        const st = this.statuses()
        const plain = allNodes(topic.children).filter(n => !st.isOption(n) && !st.isGroup(n))
        const want = topic.children.length ? !plain.every(n => st.effective(n)) : !st.effective(topic)
        for (const n of plain) this.setWant(n, want)
        if (!topic.children.length) this.setWant(topic, want)
    }

    /** Puts back the nodes of an undo step, each as it was before that click: a claim the user approved is a claim again. */
    undo(step: UndoStep) {
        const byNum = new Map(allNodes(this.outline.nodes).map(n => [n.num, n]))
        for (const s of step.nodes) {
            const node = byNum.get(s.num)
            if (node) this.setWant(node, s.file === 'approved')
        }
    }
}

/** The undo step of a click: the nodes whose tick it changes, as they are before it; null when it changes nothing. */
export function undoStep(outline: Outline, draft: Draft): UndoStep | null {
    const nodes = allNodes(outline.nodes)
        .filter(n => n.num in draft.overrides)
        .map(n => ({ num: n.num, file: n.status }))
    return nodes.length ? { nodes, collapsed: [] } : null
}

/** Run requests that ended: the node is no longer an action waiting to run (the agent finished it, or it is gone). */
export function settledPatch(outline: Outline, v: ViewerState): StatePatch | null {
    const waiting = new Set(allNodes(outline.nodes).filter(n => stillRunning(n, v.runs[n.num])).map(n => n.num))
    const ran = Object.keys(v.runs).filter(k => !waiting.has(k))
    return ran.length ? { runs: Object.fromEntries(ran.map(k => [k, null])) } : null
}
