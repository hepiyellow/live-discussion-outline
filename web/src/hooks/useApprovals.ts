import { useCallback, useEffect, useRef } from 'react'
import { useNotify } from '@/components/Notice'
import { isOpenIn } from '@/components/OutlineTab'
import { Approvals, approvalText, batchNums, diffDraft, draftOf, pendingNums, referenceTo, settledPatch, snapshot, undoStep, type Retracted } from '@/lib/approvals'
import { allNodes, nodeLabel, pathNums } from '@/lib/outline'
import { copyText, sendToSession } from '@/lib/send'
import { Statuses } from '@/lib/status'
import { collapseAnimated } from '@/lib/sticky'
import type { Outline, OutlineNode, StatePatch, ViewerState } from '@/types'

/** How long after the last click the page sends a burst of approvals as one message. */
export const SEND_DELAY = 1200
const UNDO_STEPS = 50

/**
 * The user's approvals, picks, runs and undos. Linked to a session (the outline names a terminal), each change goes to
 * it by itself; otherwise approvals are copied, and the status bar lists those not copied yet.
 */
export function useApprovals(outline: Outline, viewer: ViewerState, patch: (p: StatePatch) => Promise<void>, onSent: () => void = () => {}) {
    const notify = useNotify()
    const retracted = useRef<Retracted>(new Set())
    const latest = useRef({ outline, viewer })
    latest.current = { outline, viewer }
    const timer = useRef<number>(undefined)
    const linked = !!outline.terminal

    // Overrides the agent has recorded, and runs it has carried out, are dropped.
    useEffect(() => {
        const p = settledPatch(outline, viewer)
        if (p) patch(p)
    }, [outline, viewer, patch])

    const sendApprovals = useCallback(async () => {
        const { outline, viewer } = latest.current
        const draft = draftOf(viewer)
        const nums = batchNums(outline, draft, retracted.current)
        const text = approvalText(outline, draft, nums)
        if (!text) return
        try {
            await sendToSession(outline.terminal, text)
            const st = new Statuses(outline.nodes, draft.overrides)
            const byNum = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
            patch({ sent: Object.fromEntries(nums.flatMap(n => (byNum.has(n) ? [[n, st.effective(byNum.get(n)!)]] : []))) })
            nums.forEach(n => retracted.current.delete(n))
            onSent()
            notify(`Sent: ${text.split('\n').join(' · ')}`)
        } catch (e) {
            notify(`Not sent: ${(e as Error).message}`, true)
        }
    }, [patch, notify, onSent])

    /** After a change: linked, send it with the others of this burst; else copy what is pending. */
    const changed = useCallback(
        (want: boolean, draft: ReturnType<typeof draftOf>) => {
            if (linked) {
                clearTimeout(timer.current)
                timer.current = window.setTimeout(sendApprovals, SEND_DELAY)
                return
            }
            if (!want) return
            const text = approvalText(latest.current.outline, draft, pendingNums(latest.current.outline, draft))
            if (text) copyText(text).then(ok => ok && notify('Copied to clipboard'))
        },
        [linked, sendApprovals, notify],
    )

    /**
     * Applies a click: changes the overrides, records an undo step, and collapses the parents the click completed (the
     * outermost one animated, scrolled to the top).
     */
    const apply = useCallback(
        (node: OutlineNode, act: (a: Approvals) => void) => {
            const { outline, viewer } = latest.current
            const before = snapshot(outline, viewer.overrides)
            const draft = draftOf(viewer)
            act(new Approvals(outline, draft, retracted.current))
            const step = undoStep(before, draft.overrides)
            const p = diffDraft(draftOf(viewer), draft)
            if (!Object.keys(p).length && !step) return

            const byNum = new Map(allNodes(outline.nodes).map(n => [n.num, n]))
            const chain = pathNums(node.num)
                .reverse()
                .map(n => byNum.get(n)!)
                .filter(n => n.children.length)
            const was = new Statuses(outline.nodes, viewer.overrides)
            const now = new Statuses(outline.nodes, draft.overrides)
            const isOpen = isOpenIn(viewer.open)
            const done = chain.filter(n => !was.isComplete(n) && now.isComplete(n) && isOpen(n))
            if (step) {
                step.collapsed = done.map(n => n.num)
                p.undo = [...viewer.undo, step].slice(-UNDO_STEPS)
            }
            patch(p)
            if (done.length) {
                const close = (nums: string[]) => patch({ open: Object.fromEntries(nums.map(n => [n, false])) })
                const outer = done[done.length - 1]
                close(done.slice(0, -1).map(n => n.num))
                collapseAnimated(outer.num, () => close([outer.num]))
            }
            changed(Object.values(p.overrides ?? {}).some(v => v === true), draft)
        },
        [patch, changed],
    )

    const clickNode = useCallback((node: OutlineNode) => apply(node, a => a.clickNode(node)), [apply])
    const clickTopic = useCallback((topic: OutlineNode) => apply(topic, a => a.clickTopic(topic)), [apply])

    const undo = useCallback(() => {
        const { outline, viewer } = latest.current
        const step = viewer.undo.at(-1)
        if (!step) return
        const draft = draftOf(viewer)
        new Approvals(outline, draft, retracted.current).undo(step)
        const p = diffDraft(draftOf(viewer), draft)
        p.undo = viewer.undo.slice(0, -1)
        if (step.collapsed.length) p.open = Object.fromEntries(step.collapsed.map(n => [n, true]))
        patch(p)
        if (linked) changed(false, draft)
        notify('Undone')
    }, [patch, changed, linked, notify])

    /** Play on an @action node: asks the agent to run it; the button waits until the agent marks it @ran. */
    const run = useCallback(
        async (node: OutlineNode) => {
            const { outline, viewer } = latest.current
            if (viewer.runs[node.num]) return
            const text = `Run in the outline: ${nodeLabel(node).replace(/\.$/, '')}.`
            if (!outline.terminal) {
                if (await copyText(text)) notify('Copied to clipboard')
                return
            }
            try {
                await sendToSession(outline.terminal, text)
                patch({ runs: { [node.num]: 1 } })
                onSent()
                notify(`Sent: ${text}`)
            } catch (e) {
                notify(`Not sent: ${(e as Error).message}`, true)
            }
        },
        [patch, notify, onSent],
    )

    /** Copies what is pending (unlinked), and counts it as sent. */
    const copyPending = useCallback(
        async (prefix = '', suffix = '') => {
            const { outline, viewer } = latest.current
            const draft = draftOf(viewer)
            const nums = pendingNums(outline, draft)
            const text = [approvalText(outline, draft, nums), prefix].filter(Boolean).join('\n') + suffix
            if (!(await copyText(text))) return notify('The clipboard is not available', true)
            if (nums.length) patch({ sent: Object.fromEntries(nums.map(n => [n, draft.overrides[n]])) })
            notify('Copied to clipboard')
        },
        [patch, notify],
    )

    /** The reference button: copies a reference to the node to paste into the chat, with any pending approvals first. */
    const reference = useCallback(
        (node: OutlineNode) => {
            const ref = referenceTo(latest.current.outline, node)
            if (linked || node.level === 1) copyText(`${ref} — `).then(ok => ok && notify('Copied to clipboard'))
            else copyPending(ref, ' — ')
        },
        [linked, copyPending, notify],
    )

    const drop = useCallback((nums: string[]) => patch({ overrides: Object.fromEntries(nums.map(n => [n, null])) }), [patch])

    const pending = linked ? [] : pendingNums(outline, draftOf(viewer))
    return { linked, clickNode, clickTopic, undo, run, reference, pending, drop, copyPending }
}
