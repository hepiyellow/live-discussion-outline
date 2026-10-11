import { useFileApprovals } from '@/hooks/useFileApprovals'
import { useServerApprovals } from '@/hooks/useServerApprovals'
import type { Outline, StatePatch, ViewerState } from '@/types'

/**
 * The user's approvals, picks, runs and undos, as the outline's mode has them: in file mode the page tells the agent in
 * its session and a tick is pending until the agent records it in the file; in server mode the server records it at
 * once. An outline's mode never changes, and the component that calls this is keyed on it, so the same hook runs on
 * every render.
 */
export const useApprovals = (outline: Outline, viewer: ViewerState, patch: (p: StatePatch) => Promise<void>, onSent?: () => void) =>
    outline.mode === 'server' ? useServerApprovals(outline, viewer, patch, onSent) : useFileApprovals(outline, viewer, patch, onSent)
