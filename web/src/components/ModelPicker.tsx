import { useEffect, useState } from 'react'
import type { Using } from '@/hooks/useSession'
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
 * The agent a model belongs to, for the label before the pickers: told from the model id the transcript names, or the
 * name the outline's `Model:` line gives ("Claude Sonnet 5.5"). Empty when it is not known, so nothing is guessed.
 */
function agentOf(model: string, line: string) {
    const name = `${model} ${line}`.toLowerCase()
    if (/\bclaude\b|claude-/.test(name)) return 'Claude'
    if (/\bcodex\b|\bgpt-|\bgpt\b/.test(name)) return 'Codex'
    return ''
}

/** The picker's value for a model as the transcript names it: a dated or suffixed id is the model it starts with. */
const modelOf = (id: string) => MODELS.find(([known]) => id.startsWith(known))?.[0] ?? id

/**
 * What the user picked and the session has not answered with yet. `at` is the agent's last answer when the pick
 * could take effect: a pick made while the agent works is run by Claude Code only once the turn ends, so it has no
 * `at` until then. The pick holds until an answer comes after `at`; that answer says what the session uses.
 */
interface Pick {
    model?: string
    effort?: string
    at?: string
}

// By session, outside the component: the Terminal tab takes the input box away, and the pick must outlast that.
const picks = new Map<string, Pick>()

/**
 * The model and effort pickers. They show what the session's agent last answered with, which Claude Code writes in
 * its transcript on every answer; before the first answer, or without a transcript, what the outline's `Model:` line
 * names (the agent writes that line, and it can be out of date). Changing one types /model or /effort into the session
 * and shows at once; the agent's next answer confirms it, or shows what the session uses instead. Claude Code's own
 * question about a switch is answered for the user (switching.js on the server): the pick here is their decision.
 */
export function ModelPicker({ outline, using, busy }: { outline: Outline; using?: Using; busy: boolean }) {
    const notify = useNotify()
    const key = outline.session || outline.terminal
    const [, redraw] = useState(0)
    const [sending, setSending] = useState(false)
    const at = using?.at ?? ''

    useEffect(() => {
        const pick = picks.get(key)
        if (!pick) return
        if (pick.at === undefined) {
            // The turn it was picked in has ended: from here on, an answer is one the pick applies to.
            if (!busy) pick.at = at
            return
        }
        if (pick.at === at) return
        picks.delete(key)
        redraw(n => n + 1)
    }, [key, at, busy])

    const base = using ? { model: modelOf(using.model), effort: using.effort } : fromLine(outline.model)
    const pick = picks.get(key)
    const shown = { model: pick?.model ?? base.model, effort: pick?.effort ?? base.effort }
    const agent = agentOf(using?.model ?? shown.model, outline.model)
    const tip = outline.terminal
        ? `Sends /model or /effort to the session (tmux ${outline.terminal}). When the conversation is cached for the current one, the next response is slower and uses more tokens: Claude Code asks before such a switch, and a pick here answers yes. Claude Code also saves the choice as your default for new sessions.`
        : 'Only for outlines whose session runs in tmux'
    // The choice shows at once, and goes back if it cannot be sent.
    const choose = async (kind: 'model' | 'effort', value: string) => {
        if (!value) return
        const before = picks.get(key)
        picks.set(key, { ...before, [kind]: value, at: busy ? undefined : at })
        setSending(true)
        try {
            await sendToSession(outline.terminal, `/${kind} ${value}`)
        } catch (e) {
            if (before) picks.set(key, before)
            else picks.delete(key)
            notify(`Not sent: ${(e as Error).message}`, true)
        }
        setSending(false)
    }
    const select = 'rounded-md border bg-background px-1.5 py-[3px] text-[13px] text-foreground disabled:text-muted-foreground'
    return (
        <span className="inline-flex items-center gap-1.5" title={tip}>
            {/* The agent, as text: it is what the session runs, not something the page changes. */}
            {agent && (
                <span data-agent className="text-[13px] text-muted-foreground">
                    {agent}
                </span>
            )}
            <select aria-label="Model" className={select} disabled={!outline.terminal || sending} value={shown.model} onChange={e => choose('model', e.target.value)}>
                {!shown.model && <option value="">Model</option>}
                {/* A model the list does not know still shows, by its id. */}
                {shown.model && !MODELS.some(([v]) => v === shown.model) && <option value={shown.model}>{shown.model}</option>}
                {MODELS.map(([v, l]) => (
                    <option key={v} value={v}>
                        {l}
                    </option>
                ))}
            </select>
            <select aria-label="Effort" className={select} disabled={!outline.terminal || sending} value={shown.effort} onChange={e => choose('effort', e.target.value)}>
                {!shown.effort && <option value="">Effort</option>}
                {shown.effort && !EFFORTS.includes(shown.effort) && <option value={shown.effort}>{shown.effort}</option>}
                {EFFORTS.map(v => (
                    <option key={v} value={v}>
                        {v}
                    </option>
                ))}
            </select>
        </span>
    )
}
