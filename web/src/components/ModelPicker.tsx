import { useState } from 'react'
import { sendToSession } from '@/lib/send'
import type { Outline } from '@/types'
import { useNotify } from './Notice'

const MODELS: [string, string][] = [
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** The model and effort the outline's `Model:` line names ("Claude Sonnet 5.5, low"). */
function fromLine(line: string) {
    const model = MODELS.find(([, label]) => new RegExp(`\\b${label.split(' ')[0]}\\b`, 'i').test(line))?.[0] ?? ''
    const effort = /\b(low|medium|high|xhigh|max)\b/i.exec(line)?.[1].toLowerCase() ?? ''
    return { model, effort }
}

/**
 * The model and effort pickers: they start from the outline's Model line; changing one types /model or /effort into
 * the session. The line catches up only when the agent rewrites it, so the page shows what was sent until then.
 */
export function ModelPicker({ outline }: { outline: Outline }) {
    const notify = useNotify()
    const [sent, setSent] = useState<{ line: string; model?: string; effort?: string }>({ line: outline.model })
    const [busy, setBusy] = useState(false)
    const line = fromLine(outline.model)
    const shown = sent.line === outline.model ? { ...line, ...Object.fromEntries(Object.entries(sent).filter(([k]) => k !== 'line')) } : line
    const tip = outline.terminal
        ? `Sends /model or /effort to the session (tmux ${outline.terminal}). Claude Code also saves the choice as your default for new sessions.`
        : 'Only for outlines whose session runs in tmux'
    // The choice shows at once, and goes back if it cannot be sent.
    const pick = async (kind: 'model' | 'effort', value: string) => {
        if (!value) return
        const before = sent
        setSent(s => ({ ...(s.line === outline.model ? s : {}), line: outline.model, [kind]: value }))
        setBusy(true)
        try {
            await sendToSession(outline.terminal, `/${kind} ${value}`)
        } catch (e) {
            setSent(before)
            notify(`Not sent: ${(e as Error).message}`, true)
        }
        setBusy(false)
    }
    const select = 'rounded-md border bg-background px-1.5 py-[3px] text-[13px] text-foreground disabled:text-muted-foreground'
    return (
        <span className="inline-flex gap-1.5" title={tip}>
            <select aria-label="Model" className={select} disabled={!outline.terminal || busy} value={shown.model} onChange={e => pick('model', e.target.value)}>
                {!shown.model && <option value="">Model</option>}
                {MODELS.map(([v, l]) => (
                    <option key={v} value={v}>
                        {l}
                    </option>
                ))}
            </select>
            <select aria-label="Effort" className={select} disabled={!outline.terminal || busy} value={shown.effort} onChange={e => pick('effort', e.target.value)}>
                {!shown.effort && <option value="">Effort</option>}
                {EFFORTS.map(v => (
                    <option key={v} value={v}>
                        {v}
                    </option>
                ))}
            </select>
        </span>
    )
}
