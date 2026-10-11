import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_DIR, settingsFile } from '../config.js'
import { extractHeaders } from '../outline.js'

// The outlines folder as the Outline app sets it: asked for on the first run, and changed from the Settings menu,
// which offers to move the outlines along.

export { DEFAULT_DIR }

/** Whether the app should ask for the outlines folder: nothing has written a settings file yet. */
export const isFirstRun = () => !fs.existsSync(settingsFile())

/** `dir` as the settings file holds it: with `~` for the home folder, so the file reads the same for any user. */
export function tildePath(dir, home = os.homedir()) {
    const rel = path.relative(home, dir)
    if (rel === '') return '~'
    return rel.startsWith('..') || path.isAbsolute(rel) ? dir : `~/${rel}`
}

// Finder's own files are not content: they are neither moved nor a reason to keep a folder.
const NOT_CONTENT = new Set(['.DS_Store'])

/** Every file under `root`, as paths relative to it. */
function filesUnder(root, rel = '') {
    let entries
    try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
        return []
    }
    return entries.flatMap(e => {
        if (NOT_CONTENT.has(e.name)) return []
        const child = path.join(rel, e.name)
        return e.isDirectory() ? filesUnder(root, child) : [child]
    })
}

/** `project/file.md` directly in a project folder is an outline; dot folders (.state, .trash) hold other things. */
function outlineOf(rel) {
    const parts = rel.split(path.sep)
    if (parts.length !== 2 || parts[0].startsWith('.') || !parts[1].endsWith('.md')) return undefined
    return { project: parts[0], file: parts[1].slice(0, -3) }
}

const inside = (child, parent) => {
    const rel = path.relative(parent, child)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * What moving the outlines folder `from` to `to` would do, without doing it. Everything in the folder moves: the
 * project folders with their outlines, and the dot folders (viewer state, trash), so read marks and unsent approvals
 * move with their outlines. A file whose place in `to` is taken stays where it is.
 *
 * - `moves`: the files that move, relative to the folder; `outlines`: how many of them are outlines.
 * - `skipped`: the files that stay because `to` already has one at that path.
 * - `running`: the outlines whose session still runs (`isRunning({ session, terminal })`), which will keep being
 *   written at the old path: `{ project, file, title }`.
 * - `blocked`: why nothing can move: `same` folder, or `inside` when `to` is within `from`.
 */
export function movePlan({ from, to, isRunning = () => false }) {
    const plan = { from, to, moves: [], skipped: [], outlines: 0, running: [], blocked: undefined }
    if (path.resolve(from) === path.resolve(to)) return { ...plan, blocked: 'same' }
    if (inside(path.resolve(to), path.resolve(from))) return { ...plan, blocked: 'inside' }
    for (const rel of filesUnder(from)) {
        const outline = outlineOf(rel)
        if (fs.existsSync(path.join(to, rel))) plan.skipped.push(rel)
        else {
            plan.moves.push(rel)
            if (outline) plan.outlines++
        }
        if (!outline) continue
        try {
            const { title, session, terminal } = extractHeaders(fs.readFileSync(path.join(from, rel), 'utf8'))
            if ((session || terminal) && isRunning({ session, terminal })) plan.running.push({ ...outline, title: title || outline.file })
        } catch {}
    }
    return plan
}

/** Removes the folders under `dir` that hold nothing (but Finder's files), deepest first; `dir` itself stays. */
function removeEmptyFolders(dir, top = true) {
    let entries
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return
    }
    for (const e of entries) if (e.isDirectory()) removeEmptyFolders(path.join(dir, e.name), false)
    if (top) return
    try {
        const left = fs.readdirSync(dir)
        if (left.some(name => !NOT_CONTENT.has(name))) return
        fs.rmSync(dir, { recursive: true })
    } catch {}
}

/**
 * Carries out a move plan. A file that cannot be moved is left where it is and reported: `{ moved, failed }`, where
 * `failed` lists `{ file, error }`.
 */
export function applyMove(plan) {
    let moved = 0
    const failed = []
    for (const rel of plan.moves) {
        const source = path.join(plan.from, rel)
        const target = path.join(plan.to, rel)
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            try {
                fs.renameSync(source, target)
            } catch (e) {
                // Another disk: a rename cannot cross it.
                if (e.code !== 'EXDEV') throw e
                fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
                fs.rmSync(source)
            }
            moved++
        } catch (e) {
            failed.push({ file: rel, error: e.message })
        }
    }
    removeEmptyFolders(plan.from)
    return { moved, failed }
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** How many of `names` a dialog lists before saying how many more there are. */
const LISTED = 8

/** The question the app asks before carrying out a move plan: `{ message, detail }`. */
export function moveQuestion(plan) {
    const message = plan.outlines ? `Move ${count(plan.outlines, 'outline')} to the new folder?` : 'Move the trash and the page’s saved state to the new folder?'
    const detail = [`From ${tildePath(plan.from)}\nto ${tildePath(plan.to)}`]
    if (plan.outlines) detail.push('The trash and what the page remembers for each outline (read marks, unsent approvals) move with them.')
    if (plan.running.length) {
        const names = plan.running.slice(0, LISTED).map(o => `• ${o.title} (${o.project})`)
        if (plan.running.length > LISTED) names.push(`• and ${plan.running.length - LISTED} more`)
        const these = plan.running.length === 1 ? 'The session of this outline is still running and will keep writing it' : 'The sessions of these outlines are still running and will keep writing them'
        detail.push(`${these} in the old folder:\n${names.join('\n')}`)
    }
    if (plan.skipped.length) detail.push(`${count(plan.skipped.length, 'file stays', 'files stay')} in the old folder, because the new folder already has a file of that name.`)
    return { message, detail: detail.join('\n\n') }
}
