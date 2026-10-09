import fs from 'node:fs'
import path from 'node:path'

// Per-viewer state lives on the server (ADR 0001): one JSON file per outline, under `.state/` in the outlines folder,
// so the Outline app and a browser show the same state. There is one user, so it has no user key; two windows on one
// outline share it, and the last write to a node wins.

export const STATE_DIR = '.state'

/**
 * The sections of an outline's state. Map sections hold one entry per node (or message) and merge key by key; the
 * others are replaced whole.
 * - open: node number → whether the viewer opened (true) or closed (false) it
 * - overrides: node number → the approval the viewer wants and the file does not show yet
 * - sent: node number → the override already sent to the session
 * - backTo: node number → 1 when undoing reopens a former claim ("Back to claim")
 * - read: node number → the version of the node the viewer last read
 * - runs: node number → 1 once the viewer asked the agent to run that action
 * - seen: message id → 1 once the viewer saw it in an inbox
 * - undo: the viewer's undo steps, newest last
 * - draft: the input box's text
 */
const MAPS = ['open', 'overrides', 'sent', 'backTo', 'read', 'runs', 'seen']
const OTHERS = { undo: Array.isArray, draft: v => typeof v === 'string' }
export const SECTIONS = [...MAPS, ...Object.keys(OTHERS)]

const empty = () => ({ open: {}, overrides: {}, sent: {}, backTo: {}, read: {}, runs: {}, seen: {}, undo: [], draft: '' })

/** Keys are node numbers or message ids: short, and never anything an object treats specially. */
const KEY = /^[\w.:-]{1,200}$/
/** Most entries a map keeps; past this the oldest go. */
const MAX_KEYS = 5000
const MAX_FILE = 2_000_000

export function createStateStore(root) {
    const fileOf = (project, file) => path.join(root, STATE_DIR, project, `${file}.json`)

    function read(project, file) {
        try {
            const saved = JSON.parse(fs.readFileSync(fileOf(project, file), 'utf8'))
            const state = empty()
            for (const k of SECTIONS) if (k in saved) state[k] = saved[k]
            return state
        } catch (e) {
            if (e.code !== 'ENOENT') console.error(`ignoring unreadable state of ${project}/${file}: ${e.message}`)
            return empty()
        }
    }

    /**
     * Applies a patch: `{ <map section>: { <key>: value | null } }` sets or (null) deletes single entries, and
     * `{ undo: [...] }` or `{ draft: '...' }` replaces that section. Returns the whole new state.
     */
    function patch(project, file, change) {
        validate(change)
        const state = read(project, file)
        for (const [section, value] of Object.entries(change)) {
            if (!MAPS.includes(section)) {
                state[section] = value
                continue
            }
            const map = { ...state[section] }
            for (const [key, v] of Object.entries(value)) {
                delete map[key]
                if (v !== null) map[key] = v
            }
            const keys = Object.keys(map)
            for (const key of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete map[key]
            state[section] = map
        }
        const text = JSON.stringify(state)
        if (text.length > MAX_FILE) throw new Error('state too large')
        const target = fileOf(project, file)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        // Written whole and then renamed into place, so a reader never sees half a file.
        const tmp = `${target}.${process.pid}.tmp`
        fs.writeFileSync(tmp, text)
        fs.renameSync(tmp, target)
        return state
    }

    return { read, patch }
}

function validate(change) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('a patch is an object')
    for (const [section, value] of Object.entries(change)) {
        if (OTHERS[section]) {
            if (!OTHERS[section](value)) throw new Error(`bad ${section}`)
            continue
        }
        if (!MAPS.includes(section)) throw new Error(`no section ${section}`)
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${section} takes an object`)
        for (const [key, v] of Object.entries(value)) {
            if (!KEY.test(key)) throw new Error(`bad key ${key}`)
            if (v !== null && !['boolean', 'number', 'string'].includes(typeof v)) throw new Error(`bad value for ${section}.${key}`)
            if (typeof v === 'string' && v.length > 200) throw new Error(`value too long for ${section}.${key}`)
        }
    }
}
