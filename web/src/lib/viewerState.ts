import type { StatePatch, ViewerState } from '@/types'

export const emptyState = (): ViewerState => ({ open: {}, overrides: {}, sent: {}, backTo: {}, read: {}, runs: {}, seen: {}, undo: [], draft: '' })

const MAPS = new Set(['open', 'overrides', 'sent', 'backTo', 'read', 'runs', 'seen'])

/** The same merge as the server's (state.js): map entries one by one, null deleting; other sections replaced. */
export function applyPatch(state: ViewerState, patch: StatePatch): ViewerState {
    const next = { ...state } as Record<string, unknown>
    for (const [section, value] of Object.entries(patch)) {
        if (!MAPS.has(section)) {
            next[section] = value
            continue
        }
        const map = { ...(state[section as keyof ViewerState] as Record<string, unknown>) }
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            delete map[key]
            if (v !== null) map[key] = v
        }
        next[section] = map
    }
    return next as unknown as ViewerState
}
