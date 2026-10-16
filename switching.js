// Model and effort switches the page asks for. Its pickers type `/model` or `/effort` into the session, and Claude Code
// may ask before it carries one out ("Switch model?", "Change effort level?": the conversation is cached for the
// current one, so the next response is slower and uses more tokens). The page takes the switch as made, and whatever
// the server types next would answer that question and be dropped by it. A pick on the page is the user's decision
// already, so the question is answered for them:
// - model: the plugin's PreModelSwitch hook asks the server whether the page asked for the switch, and Claude Code
//   then skips its question. Nothing of the terminal's screen is read.
// - effort: Claude Code has no hook for it, so the question is looked for on the session's screen and answered there.

/** How long a switch the page asked for waits for Claude Code to get to it: a command typed during a turn runs when the turn ends. */
export const ASK_MS = 60 * 60_000
/** How long a model switch stays the page's once Claude Code has asked about it: one switch runs its hook more than once. */
export const TAKEN_MS = 10_000
/** How often, and how many times, the screen is looked at for the effort question after `/effort` is typed. */
const WATCH_PAUSE = 150
const WATCH_TRIES = 12

/** What Claude Code's question about an effort change shows, and the choice Enter takes. */
export const EFFORT_QUESTION = ['Change effort level?', 'Yes, switch to']

/** The switch a line asks the session for, when it is one: `{ kind: 'model' | 'effort', value }`. */
export function switchOf(text) {
    const m = /^\/(model|effort)\s+(\S+)$/.exec(String(text).trim())
    return m ? { kind: m[1], value: m[2] } : null
}

/**
 * The switches the page asked for, by session terminal. `type(terminal, text)` types a line into a terminal, and
 * `answer(terminal, parts)` presses Enter there when its screen shows a question with these parts (terminal.js);
 * both are replaced in tests.
 */
export function createSwitches({ type, answer, now = Date.now, pause = WATCH_PAUSE, tries = WATCH_TRIES }) {
    /** terminal → `{ at, takenAt }`: a model switch asked for, and when Claude Code first asked about it. */
    const models = new Map()
    /** terminal → when an effort change was asked for whose question may still come up. */
    const efforts = new Map()

    /** Answers the effort question when the screen shows it, looking up to `looks` times. */
    async function settle(terminal, looks) {
        for (let i = 0; i < looks && efforts.has(terminal); i++) {
            if (looks > 1) await new Promise(r => setTimeout(r, pause))
            // Something else typed meanwhile, and answered it.
            if (!efforts.has(terminal)) return
            if (now() - efforts.get(terminal) > ASK_MS) return efforts.delete(terminal)
            if (answer(terminal, EFFORT_QUESTION)) {
                efforts.delete(terminal)
                // Give the agent's UI a moment to take the answer before anything else is typed.
                await new Promise(r => setTimeout(r, pause))
            }
        }
    }

    /**
     * Types a line into a session terminal: everything the server types goes through here. An effort question still
     * open (its command ran only when a turn ended) is answered first, since it would take this line's Enter as its
     * answer and drop the line.
     */
    async function typeInto(terminal, text) {
        if (efforts.has(terminal)) await settle(terminal, 1)
        const change = switchOf(text)
        if (change?.kind === 'model') models.set(terminal, { at: now() })
        await type(terminal, text)
        if (change?.kind === 'effort') {
            efforts.set(terminal, now())
            // Not waited for: the question comes up a moment after the command, or not at all.
            settle(terminal, tries).catch(() => {})
        }
    }

    /**
     * Whether the model switch Claude Code is about to make in this terminal's session is one the page asked for. It
     * is from when the page asked until a little after Claude Code first asks, which covers the hook's several runs
     * for one switch.
     */
    function asked(terminal) {
        const ask = models.get(terminal)
        if (!ask) return false
        const t = now()
        if (ask.takenAt === undefined && t - ask.at <= ASK_MS) {
            ask.takenAt = t
            return true
        }
        if (ask.takenAt !== undefined && t - ask.takenAt <= TAKEN_MS) return true
        models.delete(terminal)
        return false
    }

    return { typeInto, asked }
}
