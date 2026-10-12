import fs from 'node:fs'
import path from 'node:path'

/** The folder of the outlines folder where the action logs are kept: one JSON Lines file per outline. */
export const ACTIONS_DIR = '.actions'

const readLines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])

/**
 * The action log of each outline under `root`: the user's actions on its nodes, in order. An entry is
 * `{ at, num, what, kind, hash, title }`: the user approved the node, took the approval back, picked it or ran it
 * (`what`: approved, took-back, picked, ran), when it had that kind and that wording (model.js `userEntry`). Nothing
 * is ever taken out of it: an approval taken back is an entry of its own.
 *
 * A node has no name but its number, and numbers shift when nodes are moved or removed. So the log also keeps each
 * shift, `{ at, removed, renumbered }`, and a node's entries are found by following them from the number the node had then.
 */
export function createActionLog(root) {
    const fileOf = (project, file) => path.join(root, ACTIONS_DIR, project, `${file}.jsonl`)

    function append(project, file, lines) {
        if (!lines.length) return
        fs.mkdirSync(path.dirname(fileOf(project, file)), { recursive: true })
        fs.appendFileSync(fileOf(project, file), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`)
    }

    return {
        /** Adds what the user did: entries as `userEntry` makes them. */
        record(project, file, entries, at = Date.now()) {
            append(
                project,
                file,
                entries.filter(Boolean).map(e => ({ at, ...e })),
            )
        },

        /** Notes the numbers a change took away (`removed`) and those it changed (`renumbered`: old → new). */
        renumber(project, file, { removed = [], renumbered = new Map() }, at = Date.now()) {
            // Without entries there is nothing to follow.
            if ((!removed.length && !renumbered.size) || !fs.existsSync(fileOf(project, file))) return
            append(project, file, [{ at, removed, renumbered: [...renumbered] }])
        },

        /** What the user did on the node that has the number `num` now, oldest first. */
        read(project, file, num) {
            const live = []
            for (const line of readLines(fileOf(project, file))) {
                const entry = JSON.parse(line)
                if (!entry.renumbered) {
                    live.push({ now: entry.num, entry })
                    continue
                }
                // A node that is gone takes its entries with it, before another node gets its number.
                for (const l of live) if (entry.removed.some(r => l.now === r || l.now.startsWith(`${r}.`))) l.now = ''
                const map = new Map(entry.renumbered)
                for (const l of live) if (map.has(l.now)) l.now = map.get(l.now)
            }
            return live.filter(l => l.now === num).map(l => l.entry)
        },
    }
}
