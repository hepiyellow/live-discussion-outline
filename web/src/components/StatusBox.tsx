import { CircleHelp, Sparkle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INDICATOR_LAYOUT, KEY_TITLE, markOfKey, type Box, type BoxState, type KindKey, type Mark, type MarksChange } from '@/lib/status'

function Tick({ state, radio }: { state: BoxState; radio: boolean }) {
    if (state === 'open') return null
    return (
        <svg viewBox="0 0 12 12" aria-hidden="true">
            {state === 'mixed' ? (
                <path d="M3 6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : radio ? (
                <circle cx="6" cy="6" r="3" fill="currentColor" />
            ) : (
                <path d="M2.4 6.2 4.8 8.6 9.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            )}
        </svg>
    )
}

/** The play triangle of an action: outlined while it is proposed (or running), filled once it is done, struck through when it failed. */
function PlayIcon({ filled, struck }: { filled?: boolean; struck?: boolean }) {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3v10l8-5z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            {struck && <path d="M2.5 13.5 13.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
        </svg>
    )
}

/** A kind's icon, none of them a tick: a sparkle, a question mark, or the play triangle of an action. */
const MARK_ICON: Record<Mark, React.ReactNode> = {
    claim: <Sparkle aria-hidden="true" />,
    question: <CircleHelp aria-hidden="true" />,
    answered: <CircleHelp aria-hidden="true" />,
    action: <PlayIcon />,
    done: <PlayIcon filled />,
    failed: <PlayIcon struck />,
}

const RUNNING_TITLE = 'Running: waiting for the agent to finish this action'

/** A column's icon: a claim the user approved is the sparkle filled, as a done action is the triangle filled. */
const keyIcon = (key: KindKey) => (key === 'claim-approved' ? <Sparkle fill="currentColor" aria-hidden="true" /> : MARK_ICON[markOfKey(key)])

/**
 * A node's or topic's approval box: empty, pending (the user's green tick, fading in and out until the agent records
 * it in file mode, or acknowledges it in server mode), approved (the same tick, still) or, on a parent, mixed. The tick
 * is the user's approval and nothing else; what the agent says of the node is its kind mark. A box whose tick the user
 * took back fades the same way until the agent acknowledges that (`waiting`).
 */
export function StatusBox({ box, onToggle }: { box: Box; onToggle?: () => void }) {
    const radio = box.shape === 'radio'
    const checked = box.state === 'mixed' ? 'mixed' : box.state !== 'open'
    const className = cn('ck', radio && 'radio')
    if (!onToggle)
        return (
            <span className={className} data-state={box.state} data-waiting={box.waiting || undefined} title={box.title} role={radio ? 'radio' : 'checkbox'} aria-checked={checked} aria-readonly>
                <Tick state={box.state} radio={radio} />
            </span>
        )
    return (
        <button
            type="button"
            className={className}
            data-state={box.state}
            data-waiting={box.waiting || undefined}
            title={box.title}
            role={radio ? 'radio' : 'checkbox'}
            aria-checked={checked}
            onClick={e => {
                e.stopPropagation()
                onToggle()
            }}
        >
            <Tick state={box.state} radio={radio} />
        </button>
    )
}

/**
 * What a row's own kind icon does. An action's triangle is the action indicator (`point`): it runs nothing, and shows
 * where the action's button is. Any other is a plain mark.
 */
export type OwnRole = { as: 'mark' } | { as: 'point'; onPoint: () => void }

interface MarksProps {
    /** The row's box: its own kind and the kinds found under it. */
    box: Box
    ownRole: OwnRole
    ownRunning?: boolean
    /** The columns of the view: every row draws a cell for each, so the kinds line up from row to row. */
    columns: KindKey[]
    /** An option's bubbles say "Below", a parent's "Under it". */
    below?: boolean
    isRunning: (num: string) => boolean
    /** The marks that changed as a change was opened: they grow and shrink once, and what went is drawn until then. */
    pulse?: MarksChange
    /** A bubble's click: shows the first node under the parent with that kind. */
    onShow: (num: string, key: KindKey) => void
}

/**
 * The marks at the right of a title row, where all of a row's kind marks are: one cell for each kind in view, in the
 * order of the columns, so that the marks of different rows line up one beneath the other. A row's own kind is in its
 * kind's cell. On a parent the other cells hold the kinds found under it, each an
 * outlined bubble: a button that shows the first node under the parent with that kind, with the count of them after
 * the icon when there are more than one, and a ring turning while an action among them runs.
 */
export function Marks({ box, ownRole, ownRunning, columns, below, isRunning, pulse, onShow }: MarksProps) {
    const byKey = new Map(box.extras.map(i => [i.key, i]))
    const own = box.mark
    const table = INDICATOR_LAYOUT === 'indicators-table'
    return (
        <span
            className="extras marks"
            data-layout={table ? 'table' : 'condensed'}
            style={table ? { width: `calc(var(--kcell) * ${columns.length})` } : undefined}
        >
            {columns.map(key => {
                if (own && key === box.markKey) return <OwnMark key={key} box={box} kindKey={key} role={ownRole} running={ownRunning} pulse={pulse?.keys.has(key)} />
                const item = byKey.get(key)
                const gone = pulse?.gone[key]
                if (!item && !gone) return table ? <span key={key} className="km-cell" aria-hidden="true" /> : null
                const mark = item?.mark ?? markOfKey(key)
                const nums = item?.nums ?? []
                const running = mark === 'action' && nums.some(isRunning)
                const where = below ? 'Below' : 'Under it'
                const count = item ? nums.length : gone!
                const what = running ? RUNNING_TITLE : KEY_TITLE[key].toLowerCase()
                return (
                    <span key={key} className="km-cell">
                        <button
                            type="button"
                            className="km small"
                            data-kind={mark}
                            data-key={key}
                            data-running={running || undefined}
                            data-pulse={(pulse?.keys.has(key) || !item) && pulse ? '' : undefined}
                            title={`${where}${count > 1 ? ` (${count})` : ''}: ${what} — click to show ${count > 1 ? 'the first' : 'it'}`}
                            aria-label={`${where}: ${count} × ${KEY_TITLE[key]}`}
                            onClick={e => {
                                e.stopPropagation()
                                if (item) onShow(nums[0], key)
                            }}
                        >
                            <span className="km-i">{keyIcon(key)}</span>
                            {count > 1 && <span className="km-n">{count}</span>}
                        </button>
                    </span>
                )
            })}
        </span>
    )
}

/** A row's own kind, in its kind's cell: the action indicator of an action, or a plain mark. */
function OwnMark({ box, kindKey, role, running, pulse }: { box: Box; kindKey: KindKey; role: OwnRole; running?: boolean; pulse?: boolean }) {
    const icon = <span className="km-i">{keyIcon(kindKey)}</span>
    const shared = { className: 'km small', 'data-kind': box.mark, 'data-key': kindKey, 'data-own': true, 'data-running': running || undefined, 'data-pulse': pulse ? '' : undefined }
    if (role.as === 'point') {
        const title = running ? RUNNING_TITLE : `${KEY_TITLE[kindKey]} — click to see the button that runs it`
        return (
            <span className="km-cell">
                <button
                    type="button"
                    {...shared}
                    data-point
                    title={title}
                    aria-label={title}
                    onClick={e => {
                        e.stopPropagation()
                        role.onPoint()
                    }}
                >
                    {icon}
                </button>
            </span>
        )
    }
    const title = `This node: ${running ? RUNNING_TITLE : KEY_TITLE[kindKey]}`
    return (
        <span className="km-cell">
            <span {...shared} title={title} role="img" aria-label={title}>
                {icon}
            </span>
        </span>
    )
}
