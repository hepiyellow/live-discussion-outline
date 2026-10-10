import { allNodes, nodeLabel } from '@/lib/outline'
import { Statuses } from '@/lib/status'
import type { Outline, OutlineNode, StatePatch, UndoStep, ViewerState } from '@/types'

// The user's approvals, picks and undos, ported from the old page. A click changes overrides (what the user wants and
// the file does not show yet); the page sends them to the session as one message per burst of clicks, and an override
// goes away once the agent records it in the file.

/** The parts of the viewer state a click changes. */
export interface Draft {
    overrides: Record<string, boolean>
    sent: Record<string, boolean>
    backTo: Record<string, number>
}

export const draftOf = (v: ViewerState): Draft => ({ overrides: { ...v.overrides }, sent: { ...v.sent }, backTo: { ...v.backTo } })

/** The patch that turns one draft into another: changed entries, and null for those removed. */
export function diffDraft(before: Draft, after: Draft): StatePatch {
    const patch: StatePatch = {}
    for (const section of ['overrides', 'sent', 'backTo'] as const) {
        const changes: Record<string, boolean | number | null> = {}
        for (const [k, v] of Object.entries(after[section])) if (before[section][k] !== v) changes[k] = v
        for (const k of Object.keys(before[section])) if (!(k in after[section])) changes[k] = null
        if (Object.keys(changes).length) (patch as Record<string, unknown>)[section] = changes
    }
    return patch
}

/**
 * Changes made on the page and then undone, after they were sent but before the file recorded them: they must be sent
 * as undone too. Not saved: they only live until the next send.
 */
export type Retracted = Set<string>

/** Applies the user's clicks to a draft, as the old page did. */
export class Approvals {
    constructor(
        readonly outline: Outline,
        readonly draft: Draft,
        readonly retracted: Retracted,
    ) {}

    statuses = () => new Statuses(this.outline.nodes, this.draft.overrides)
    fileDone = (node: OutlineNode) => node.status === 'approved'

    /** Sets what the user wants for one node. */
    setWant(node: OutlineNode, want: boolean) {
        const { overrides, sent, backTo } = this.draft
        const key = node.num
        delete backTo[key]
        if (key in sent && sent[key] !== want && want === this.fileDone(node)) this.retracted.add(key)
        else this.retracted.delete(key)
        if (want === this.fileDone(node)) delete overrides[key]
        else overrides[key] = want
        delete sent[key]
    }

    /** Picks an option: it is chosen, and its siblings are not. */
    choose(node: OutlineNode) {
        this.setWant(node, true)
        for (const s of this.statuses().parent(node)?.children ?? []) if (s !== node) this.setWant(s, false)
    }

    /** A click on a node's checkbox (or radio). */
    clickNode(node: OutlineNode) {
        const st = this.statuses()
        const box = st.box(node)
        const shownChecked = box.state !== 'open' && box.state !== 'mixed'
        // A claim shows a tick, but a click on it queues the user's approval rather than clearing it.
        const want = !shownChecked || (node.status === 'claim' && !(node.num in this.draft.overrides))
        if (st.isGroup(node)) {
            const kind = st.kindsOf(node)[0]
            const pick = node.children.find(c => c.tags.includes('recommended'))
            if (kind === 'pending' || kind === 'approved') node.children.forEach(c => this.setWant(c, false))
            else if (pick) this.choose(pick)
            return
        }
        if (st.isOption(node)) {
            if (box.state === 'open' || box.state === 'claim') this.choose(node)
            else this.setWant(node, false)
            return
        }
        for (const n of allNodes([node])) this.setWant(n, want)
    }

    /** A click on a topic's checkbox: approves (or reopens) every node under it, options and questions aside. */
    clickTopic(topic: OutlineNode) {
        const st = this.statuses()
        const state = st.topicBox(topic).state
        const want = !(state === 'approved' || state === 'pending')
        for (const n of allNodes(topic.children)) if (!st.isOption(n) && !st.isGroup(n)) this.setWant(n, want)
        if (!topic.children.length) this.setWant(topic, want)
    }

    /** Puts back the nodes of an undo step, each as it was before that click. */
    undo(step: UndoStep) {
        const byNum = new Map(allNodes(this.outline.nodes).map(n => [n.num, n]))
        for (const s of step.nodes) {
            const node = byNum.get(s.num)
            if (!node) continue
            const want = s.had ? s.was : s.file === 'approved'
            this.setWant(node, want)
            // A former claim that has to be sent back goes as "Back to claim"; one never sent just drops its override.
            if (!want && s.file === 'claim') this.draft.backTo[s.num] = 1
        }
    }
}

/** Each node as it is now, to tell afterwards what a click changed. */
export function snapshot(outline: Outline, overrides: Record<string, boolean>) {
    return allNodes(outline.nodes).map(n => ({ num: n.num, had: n.num in overrides, was: !!overrides[n.num], file: n.status }))
}

/** The undo step of a click: the nodes whose override it changed, as they were; null when it changed nothing. */
export function undoStep(before: ReturnType<typeof snapshot>, overrides: Record<string, boolean>): UndoStep | null {
    const nodes = before.filter(s => (s.num in overrides) !== s.had || (s.had && overrides[s.num] !== s.was))
    return nodes.length ? { nodes, collapsed: [] } : null
}

/** Overrides not yet recorded in the file nor sent (or copied). */
export function pendingNums(outline: Outline, draft: Draft) {
    return allNodes(outline.nodes)
        .filter(n => n.num in draft.overrides && draft.overrides[n.num] !== (n.status === 'approved') && draft.sent[n.num] !== draft.overrides[n.num])
        .map(n => n.num)
}

/** What a message to the session carries: pending changes, and retracted ones. */
export const batchNums = (outline: Outline, draft: Draft, retracted: Retracted) => [...new Set([...pendingNums(outline, draft), ...retracted])]

/**
 * The message for a batch: `Approved in the outline: …`, `Chosen in the outline: …` (options), `Reopened in the
 * outline: …` and `Back to claim in the outline: …` (undone claims), one line each, nodes by number and title.
 */
export function approvalText(outline: Outline, draft: Draft, nums: string[]) {
    const st = new Statuses(outline.nodes, draft.overrides)
    const byNum = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
    const nodes = nums.map(n => byNum.get(n)).filter((n): n is OutlineNode => !!n)
    const refs = (list: OutlineNode[]) => list.map(nodeLabel).join('; ')
    const on = nodes.filter(n => st.effective(n))
    const off = nodes.filter(n => !st.effective(n))
    const line = (lead: string, list: OutlineNode[]) => (list.length ? `${lead}${refs(list).replace(/\.$/, '')}.` : '')
    return [
        line('Approved in the outline: ', on.filter(n => !st.isOption(n))),
        line('Chosen in the outline: ', on.filter(n => st.isOption(n))),
        line('Reopened in the outline: ', off.filter(n => !draft.backTo[n.num])),
        line('Back to claim in the outline: ', off.filter(n => draft.backTo[n.num])),
    ]
        .filter(Boolean)
        .join('\n')
}

/** Overrides the file has caught up with (the agent recorded them): dropped, so the file's own status shows again. */
export function settledPatch(outline: Outline, v: ViewerState): StatePatch | null {
    const done = new Map(allNodes(outline.nodes).map(n => [n.num, n.status === 'approved']))
    const settled = Object.keys(v.overrides).filter(k => !done.has(k) || v.overrides[k] === done.get(k))
    // A run request ends once the node is no longer an action waiting to run (the agent marked it @ran).
    const waiting = new Set(allNodes(outline.nodes).filter(n => n.tags.includes('action') && !n.tags.includes('ran')).map(n => n.num))
    const ran = Object.keys(v.runs).filter(k => !waiting.has(k))
    // What was sent and is now what the file says needs no remembering.
    const stale = Object.keys(v.sent).filter(k => !(k in v.overrides) && (!done.has(k) || v.sent[k] === done.get(k)))
    if (!settled.length && !ran.length && !stale.length) return null
    const nulls = (keys: string[]) => Object.fromEntries(keys.map(k => [k, null]))
    const patch: StatePatch = {}
    if (settled.length) Object.assign(patch, { overrides: nulls(settled), backTo: nulls(settled.filter(k => k in v.backTo)) })
    const sent = [...settled.filter(k => k in v.sent), ...stale]
    if (sent.length) patch.sent = nulls(sent)
    if (ran.length) patch.runs = nulls(ran)
    return patch
}

/** A reference to a node to paste into the chat: `Re: outline "<title>" › 3. Topic › 3.1.2 Node`. */
export function referenceTo(outline: Outline, node: OutlineNode) {
    const topicNum = node.num.split('.')[0]
    const topic = outline.nodes.find(n => n.num === topicNum)
    const head = `Re: outline "${outline.title || outline.file}" › `
    const topicLabel = (t: OutlineNode) => `${t.num}. ${t.title}`
    if (node.level === 1) return head + topicLabel(node)
    return head + (topic ? `${topicLabel(topic)} › ` : '') + nodeLabel(node)
}
