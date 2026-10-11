import { useCallback, useEffect, useRef } from 'react'
import { useNotify } from '@/components/Notice'
import { isOpenIn } from '@/components/OutlineTab'
import { referenceTo, removalOf } from '@/lib/references'
import { Approvals, emptyDraft, settledPatch, ticksOf, undoStep, type Tick } from '@/lib/serverApprovals'
import { api, outlineApiPath } from '@/lib/api'
import { allNodes, pathNums } from '@/lib/outline'
import { copyText } from '@/lib/send'
import { Statuses } from '@/lib/status'
import { collapseAnimated } from '@/lib/sticky'
import type { Outline, OutlineNode, StatePatch, ViewerState } from '@/types'

const UNDO_STEPS = 50

/**
 * The user's approvals, picks, runs and undos in server mode. Each is recorded in the outline at once: the page sends the server the
 * ticks that changed, the server writes them and tells the agent with the user's next message. Only a run reaches the
 * agent right away, typed into its session terminal when it has one.
 */
export function useServerApprovals(outline: Outline, viewer: ViewerState, patch: (p: StatePatch) => Promise<void>, onSent: () => void = () => {}) {
    const notify = useNotify()
    const latest = useRef({ outline, viewer })
    latest.current = { outline, viewer }
    const linked = !!outline.terminal

    // Runs the agent has carried out are dropped.
    useEffect(() => {
        const p = settledPatch(outline, viewer)
        if (p) patch(p)
    }, [outline, viewer, patch])

    /** Records ticks in the outline. */
    const record = useCallback(
        async (set: Tick[]) => {
            const { outline } = latest.current
            try {
                await api(`/api/outline/${outlineApiPath(outline.project, outline.file)}/act`, { set })
            } catch (e) {
                notify(`Not recorded: ${(e as Error).message}`, true)
            }
        },
        [notify],
    )

    /**
     * Applies a click: records the ticks it changes, keeps an undo step, and collapses the parents the click completed
     * (the outermost one animated, scrolled to the top).
     */
    const apply = useCallback(
        (node: OutlineNode, act: (a: Approvals) => void) => {
            const { outline, viewer } = latest.current
            const draft = emptyDraft()
            act(new Approvals(outline, draft))
            const step = undoStep(outline, draft)
            if (!step) return

            const byNum = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
            const chain = pathNums(node.num)
                .reverse()
                .map(n => byNum.get(n)!)
                .filter(n => n.children.length)
            const was = new Statuses(outline.nodes)
            const now = new Statuses(outline.nodes, draft.overrides)
            const isOpen = isOpenIn(viewer.open)
            const done = chain.filter(n => !was.isComplete(n) && now.isComplete(n) && isOpen(n))
            step.collapsed = done.map(n => n.num)
            patch({ undo: [...viewer.undo, step].slice(-UNDO_STEPS) })
            record(ticksOf(draft))
            if (done.length) {
                const close = (nums: string[]) => patch({ open: Object.fromEntries(nums.map(n => [n, false])) })
                const outer = done[done.length - 1]
                close(done.slice(0, -1).map(n => n.num))
                collapseAnimated(outer.num, () => close([outer.num]))
            }
        },
        [patch, record],
    )

    const clickNode = useCallback((node: OutlineNode) => apply(node, a => a.clickNode(node)), [apply])
    const clickTopic = useCallback((topic: OutlineNode) => apply(topic, a => a.clickTopic(topic)), [apply])

    const undo = useCallback(() => {
        const { outline, viewer } = latest.current
        const step = viewer.undo.at(-1)
        if (!step) return
        const draft = emptyDraft()
        new Approvals(outline, draft).undo(step)
        const p: StatePatch = { undo: viewer.undo.slice(0, -1) }
        if (step.collapsed.length) p.open = Object.fromEntries(step.collapsed.map(n => [n, true]))
        patch(p)
        record(ticksOf(draft))
        notify('Undone')
    }, [patch, record, notify])

    /** Play on an action: asks the agent to run it; the button waits until the agent finishes the action. */
    const run = useCallback(
        async (node: OutlineNode) => {
            const { outline, viewer } = latest.current
            if (viewer.runs[node.num]) return
            try {
                const { typed } = await api<{ typed: boolean }>(`/api/outline/${outlineApiPath(outline.project, outline.file)}/act`, { run: node.num })
                patch({ runs: { [node.num]: 1 } })
                if (typed) onSent()
                notify(typed ? `Asked the agent to run ${node.num}` : `Recorded: the agent runs ${node.num} with your next message`)
            } catch (e) {
                notify(`Not sent: ${(e as Error).message}`, true)
            }
        },
        [patch, notify, onSent],
    )

    /** The reference button without a linked session: copies a reference to the node to paste into the chat. */
    const reference = useCallback(
        (node: OutlineNode) => copyText(`${referenceTo(latest.current.outline, node)} — `).then(ok => notify(ok ? 'Copied to clipboard' : 'The clipboard is not available', !ok)),
        [notify],
    )

    /** The trash button without a linked session: copies the removal to paste into the chat, for the user to add why. */
    const remove = useCallback(
        (node: OutlineNode) => copyText(`${removalOf(latest.current.outline, node)} — `).then(ok => notify(ok ? 'Copied to clipboard: paste it into the chat and say why' : 'The clipboard is not available', !ok)),
        [notify],
    )

    return { linked, clickNode, clickTopic, undo, run, reference, remove }
}
