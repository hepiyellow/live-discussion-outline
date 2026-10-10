import { cn } from '@/lib/utils'
import { KIND_TITLE, type Box, type BoxState, type Kind } from '@/lib/status'

function Mark({ state, radio }: { state: BoxState; radio: boolean }) {
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

/**
 * A node's or topic's checkbox: open, a claim (blue tick: the agent says what it thinks, and nothing is wrong), done
 * (filled yellow tick: an action the agent carried out), pending (green outlined tick), approved (filled green) or mixed.
 */
export function StatusBox({ box, onToggle }: { box: Box; onToggle?: () => void }) {
    const radio = box.shape === 'radio'
    const checked = box.state === 'mixed' ? 'mixed' : box.state !== 'open'
    const className = cn('ck', radio && 'radio')
    if (!onToggle)
        return (
            <span className={className} data-state={box.state} title={box.title} role={radio ? 'radio' : 'checkbox'} aria-checked={checked} aria-readonly>
                <Mark state={box.state} radio={radio} />
            </span>
        )
    return (
        <button
            type="button"
            className={className}
            data-state={box.state}
            title={box.title}
            role={radio ? 'radio' : 'checkbox'}
            aria-checked={checked}
            onClick={e => {
                e.stopPropagation()
                onToggle()
            }}
        >
            <Mark state={box.state} radio={radio} />
        </button>
    )
}

/** The kinds beside a mixed parent's box, or below an option, each once. */
export function Extras({ kinds, below }: { kinds: Kind[]; below?: boolean }) {
    if (!kinds.length) return null
    return (
        <span className="extras">
            {kinds.map(k => (
                <span key={k} className="ck small" data-state={k} title={below ? `Below: ${KIND_TITLE[k].toLowerCase()}` : KIND_TITLE[k]}>
                    <Mark state={k} radio={false} />
                </span>
            ))}
        </span>
    )
}
