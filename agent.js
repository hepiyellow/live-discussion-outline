import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { extractHeaders, renderPlain } from './outline.js'
import { OpError, allNodes, applyOperations, applyUserSet, findNode, mapText, nodeHash, normalize, parseOutline, queueText, readText, serializeOutline, waitingNotQueued } from './model.js'
import { isSessionName } from './terminal.js'
import { isSessionId } from './transcript.js'

// The agent's side of an outline in server mode (docs/adr/0003): `start`, `read` and `change` as the MCP tools call
// them, what the hooks ask for, and what the user does on the page. The server is the only writer of such an outline's
// file; what it has to remember beside the file is the outline's ledger. An outline in file mode is its agent's to write:
// nothing here reads it as a model or writes it.

/** The folder of the outlines folder where each outline's ledger is kept: one JSON file per outline. */
export const LEDGER_DIR = '.ledger'

/** Most messages a ledger keeps. */
const MAX_MESSAGES = 200
/** Most user actions a ledger keeps for an agent that never asks. */
const MAX_EVENTS = 200

const safeName = name => typeof name === 'string' && !!name && !name.startsWith('.') && !/[/\\]/.test(name)

const slug = text =>
    text
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)

const today = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The title of an outline opened before its conversation has a subject; the agent names it once it has one. */
const UNTITLED = 'New outline'

/** A refusal the caller reads as text: the tool's result, marked as an error. */
class Refusal extends Error {}

const HEADER_LINE = /^(Title|Resume|Model|Terminal|Session): /

/**
 * Outlines the server kept before outlines had a mode have a ledger and no `Mode:` line, and would read as file mode:
 * each gets the line, after its other header lines, where the server writes it. The file keeps its time of last change,
 * which orders the outline list.
 */
export function markLedgered(root) {
    const ledgers = path.join(root, LEDGER_DIR)
    if (!fs.existsSync(ledgers)) return
    for (const project of fs.readdirSync(ledgers, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const f of fs.readdirSync(path.join(ledgers, project.name))) {
            if (!f.endsWith('.json')) continue
            const full = path.join(root, project.name, `${f.slice(0, -5)}.md`)
            try {
                const text = fs.readFileSync(full, 'utf8')
                if (extractHeaders(text).mode === 'server') continue
                const lines = text.split('\n')
                let at = 0
                while (HEADER_LINE.test(lines[at] ?? '')) at++
                lines.splice(at, 0, 'Mode: server')
                const { atime, mtime } = fs.statSync(full)
                fs.writeFileSync(full, lines.join('\n'))
                fs.utimesSync(full, atime, mtime)
            } catch (e) {
                if (e.code !== 'ENOENT') console.error(`marking ${project.name}/${f} as server mode: ${e.message}`)
            }
        }
    }
}

/**
 * @param root the outlines folder
 * @param config the settings (config.js)
 * @param linkBase () => the start of the page's link
 * @param onWrite (project, file, text) => called after an outline's file was written
 * @param onMessages (project, file) => called after an outline got a message
 * @param typeInto async (terminal, text) => types a line into a session terminal; throws when there is none
 */
export function createAgentApi({ root, config, linkBase, onWrite = () => {}, onMessages = () => {}, typeInto }) {
    const fileOf = (project, file) => path.join(root, project, `${file}.md`)
    const ledgerOf = (project, file) => path.join(root, LEDGER_DIR, project, `${file}.json`)

    /**
     * An outline's ledger:
     * - events: what the user did on the page that the agent has not been told yet
     * - shown: node number → the hash of the node as the agent last saw it (model.js `nodeHash`)
     * - messages: the agent's messages, for the inbox
     * - cwd: the working folder of the session that started it
     * - untitled: true while the outline has the placeholder title, which the agent may still replace
     */
    function readLedger(project, file) {
        const ledger = { events: [], shown: {}, messages: [], cwd: '' }
        try {
            Object.assign(ledger, JSON.parse(fs.readFileSync(ledgerOf(project, file), 'utf8')))
        } catch (e) {
            if (e.code !== 'ENOENT') console.error(`ignoring unreadable ledger of ${project}/${file}: ${e.message}`)
        }
        return ledger
    }

    function writeLedger(project, file, ledger) {
        const target = ledgerOf(project, file)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        const tmp = `${target}.${process.pid}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(ledger))
        fs.renameSync(tmp, target)
    }

    const readModel = (project, file) => parseOutline(fs.readFileSync(fileOf(project, file), 'utf8'))

    function writeModel(project, file, model) {
        // An outline has one writer, and in file mode it is the agent: writing the model would reformat the agent's file.
        if (model.headers.mode !== 'server') throw new Error(`${project}/${file} is in file mode: the server does not write it`)
        const text = serializeOutline(model)
        fs.mkdirSync(path.dirname(fileOf(project, file)), { recursive: true })
        fs.writeFileSync(fileOf(project, file), text)
        onWrite(project, file, text)
    }

    /** Every outline in the folder: `{ project, file, mtime }`, newest first. */
    function outlines() {
        const out = []
        for (const project of fs.readdirSync(root, { withFileTypes: true })) {
            if (!project.isDirectory() || project.name.startsWith('.')) continue
            for (const f of fs.readdirSync(path.join(root, project.name))) {
                if (!f.endsWith('.md')) continue
                out.push({ project: project.name, file: f.slice(0, -3), mtime: fs.statSync(path.join(root, project.name, f)).mtimeMs })
            }
        }
        return out.sort((a, b) => b.mtime - a.mtime)
    }

    const headersOf = o => extractHeaders(fs.readFileSync(fileOf(o.project, o.file), 'utf8'))

    /**
     * The outline a call is about: the one it names (`project/file`), else the newest that links to the caller's
     * session, else (an agent that does not know its session id) the newest started from its working folder that
     * links to no session. Only outlines in server mode count: one in file mode is not the tools' to read or change, so
     * naming it is refused, and a session whose outline is in file mode has no outline here.
     */
    function locate({ outline, session, cwd }) {
        if (outline) {
            const [project, ...rest] = String(outline).split('/')
            const file = rest.join('/')
            if (!safeName(project) || !safeName(file) || !fs.existsSync(fileOf(project, file))) throw new Refusal(`There is no outline ${outline}.`)
            if (headersOf({ project, file }).mode !== 'server')
                throw new Refusal(`The outline ${outline} is kept by its agent as a file (file mode), so the outline tools neither read nor change it. Its agent edits the file itself, following the outline-file skill.`)
            return { project, file }
        }
        const all = outlines()
            .map(o => ({ ...o, headers: headersOf(o) }))
            .filter(o => o.headers.mode === 'server')
        if (session && isSessionId(session)) {
            const found = all.find(o => o.headers.session === session)
            if (found) return found
        }
        if (cwd) return all.find(o => readLedger(o.project, o.file).cwd === cwd && (!session || !o.headers.session))
        return undefined
    }

    const need = where => {
        const found = locate(where)
        if (!found) throw new Refusal('This session has no outline yet. Call start first.')
        return found
    }

    const urlOf = ({ project, file }) => `${linkBase()}/${encodeURIComponent(project)}/${encodeURIComponent(file)}`

    /** What the user did on the page since the agent was last told, as text; telling it empties the list. */
    function takeEvents(ledger) {
        const events = ledger.events
        ledger.events = []
        if (!events.length) return ''
        // A node ticked and unticked again says only where it ended up.
        const last = new Map()
        for (const e of events) last.set(e.kind === 'run' || e.kind === 'renamed' ? `${e.kind}:${e.num}` : e.num, e)
        const by = kind => [...last.values()].filter(e => e.kind === kind)
        const refs = list => list.map(e => `${e.num} ${e.title}`).join('; ')
        const lines = []
        if (by('approved').length) lines.push(`- approved ${refs(by('approved'))}`)
        if (by('picked').length) lines.push(`- picked ${refs(by('picked'))}`)
        if (by('reopened').length) lines.push(`- took their approval back from ${refs(by('reopened'))}`)
        for (const e of by('run')) lines.push(`- pressed Run on ${e.num} ${e.title}: carry it out now, then finish it with its outcome`)
        for (const e of by('renamed')) lines.push(`- renamed the outline to "${e.title}"`)
        return `On the page, since you were last told, the user:\n${lines.join('\n')}\nThe outline already shows this; do not record it again.`
    }

    function waitingText(model) {
        const waiting = waitingNotQueued(model)
        if (!waiting.length) return ''
        const lines = waiting.slice(0, 10).map(w => `- ${w.num} [${w.kind}] ${w.title}`)
        if (waiting.length > 10) lines.push(`- … and ${waiting.length - 10} more`)
        return `Waiting on the user and not in the queue:\n${lines.join('\n')}`
    }

    const sections = (...parts) => parts.filter(Boolean).join('\n\n')

    /** start: opens an outline for the session, or reattaches to the one it has. */
    function start({ session = '', terminal = '', cwd = '', project = '', title = '', model: agentModel = '', outline = '' }) {
        const sessionId = isSessionId(session) ? session : ''
        const term = isSessionName(terminal) ? terminal : ''
        const found = locate({ outline, session: sessionId, cwd })
        const resume = sessionId && config.resumeTemplate ? config.resumeTemplate.replaceAll('{session}', sessionId) : ''
        const name = String(title).replace(/\s+/g, ' ').trim().slice(0, 300)
        if (found) {
            const model = readModel(found.project, found.file)
            const ledger = readLedger(found.project, found.file)
            const before = JSON.stringify(model.headers)
            // The placeholder title is the agent's to replace; any other title is the user's to keep.
            const named = !!name && !!ledger.untitled
            if (named) {
                model.headers.title = name
                ledger.untitled = false
            }
            if (sessionId) model.headers.session = sessionId
            if (term) model.headers.terminal = term
            if (resume) model.headers.resume = resume
            if (agentModel) model.headers.model = String(agentModel).slice(0, 100)
            if (JSON.stringify(model.headers) !== before) writeModel(found.project, found.file, model)
            if (cwd) ledger.cwd = cwd
            const events = takeEvents(ledger)
            writeLedger(found.project, found.file, ledger)
            const map = mapText(model)
            return {
                outline: `${found.project}/${found.file}`,
                url: urlOf(found),
                text: sections(
                    named
                        ? `The outline is now named "${name}". It is filed under the project "${found.project}".\nPage: ${urlOf(found)}`
                        : `Reattached to the outline "${model.headers.title || found.file}", filed under the project "${found.project}".${ledger.untitled ? ' It is not named yet: call start with a title once the conversation has a subject.' : " Its name is the user's to change: keep it."}\nPage: ${urlOf(found)}`,
                    map ? `Map:\n${map}` : 'It has no nodes yet: add them with change.',
                    model.queue.length ? `Queue:\n${queueText(model)}` : '',
                    events,
                    map ? 'Read a node before you update it: you have not seen its text in this context.' : '',
                ),
            }
        }
        const folder = safeName(project) ? project : path.basename(cwd || '') || 'outlines'
        if (!safeName(folder)) throw new Refusal(`${JSON.stringify(folder)} cannot be a project name.`)
        const base = `${today()}-${slug(name || UNTITLED) || 'outline'}`
        let file = base
        for (let i = 2; fs.existsSync(fileOf(folder, file)); i++) file = `${base}-${i}`
        const created = { project: folder, file }
        writeModel(folder, file, { headers: { title: name || UNTITLED, resume, model: String(agentModel).slice(0, 100), terminal: term, session: sessionId, mode: 'server' }, intro: '', nodes: [], queue: [] })
        writeLedger(folder, file, { events: [], shown: {}, messages: [], cwd, untitled: !name })
        const where = `It is filed under the project "${folder}", which the session it started from decides: say nothing else about where it is.`
        return {
            outline: `${folder}/${file}`,
            url: urlOf(created),
            text: name
                ? `Opened the outline "${name}".\nPage: ${urlOf(created)}\n${where}\nIt is empty: build it from the conversation so far with one change, then give the user the page link.`
                : `Opened an outline that is not named yet.\nPage: ${urlOf(created)}\n${where}\nGive the user the page link and ask what they want to work on. Once the conversation has a subject, call start again with it as the title, and mirror from then on.`,
        }
    }

    /** read: the whole outline, or one node and its descendants. */
    function read({ num = '', ...where }) {
        const at = need(where)
        const model = readModel(at.project, at.file)
        const ledger = readLedger(at.project, at.file)
        let body
        try {
            body = readText(model, num ? String(num).replace(/\.$/, '') : '')
        } catch (e) {
            if (e instanceof OpError) throw new Refusal(sections(e.message, e.hint))
            throw e
        }
        for (const node of body.shown) if (node.num) ledger.shown[node.num] = nodeHash(node)
        const events = takeEvents(ledger)
        writeLedger(at.project, at.file, ledger)
        return {
            outline: `${at.project}/${at.file}`,
            text: sections(
                num ? '' : `Outline "${model.headers.title || at.file}" (${urlOf(at)})`,
                body.text || 'The outline has no nodes yet.',
                !num && model.queue.length ? `Queue:\n${queueText(model)}` : '',
                events,
            ),
        }
    }

    /** change: applies the operations together, or none of them. */
    function change({ ops, ...where }) {
        const at = need(where)
        const model = readModel(at.project, at.file)
        const ledger = readLedger(at.project, at.file)
        const shown = { ...ledger.shown }
        let result
        try {
            result = applyOperations(model, ops, shown)
        } catch (e) {
            if (!(e instanceof OpError)) throw e
            // A stale update came back with the node as it is: the agent has now seen it.
            if (e.num) {
                const node = findNode(readModel(at.project, at.file), e.num)
                if (node) ledger.shown[e.num] = nodeHash(node)
            }
            const events = takeEvents(ledger)
            writeLedger(at.project, at.file, ledger)
            throw new Refusal(sections(`Nothing was applied. ${e.message}`, e.hint, e.text, events))
        }
        const queuedBefore = model.queue.map(i => i.num)
        const dropped = normalize(model, result.touched)
        writeModel(at.project, at.file, model)

        // Children of a renumbered or rolled-up node keep the hash they had; nodes that are gone lose theirs.
        const live = new Set(allNodes(model.nodes).map(n => n.num))
        ledger.shown = Object.fromEntries(Object.entries(shown).filter(([num]) => live.has(num)))
        if (result.messages.length) {
            const at_ = new Date().toISOString()
            for (const m of result.messages) ledger.messages.push({ id: `m:${crypto.randomUUID()}`, at: at_, num: m.num, text: m.text })
            ledger.messages = ledger.messages.slice(-MAX_MESSAGES)
        }
        const events = takeEvents(ledger)
        writeLedger(at.project, at.file, ledger)
        if (result.messages.length) onMessages(at.project, at.file)

        const notes = [...result.notes]
        for (const item of dropped) {
            if (item.gone) continue
            notes.push(`${item.num} is ${queuedBefore.includes(item.num) && result.queued ? 'left out of' : 'dropped from'} the queue: it asks nothing more of the user.`)
        }
        const renumbered = [...result.renumbered].map(([from, to]) => `${from} -> ${to}`)
        const count = ops.length
        return {
            outline: `${at.project}/${at.file}`,
            text: sections(
                `Applied ${count} operation${count === 1 ? '' : 's'}.`,
                notes.length ? notes.map(n => `Note: ${n}`).join('\n') : '',
                renumbered.length ? `Numbers changed (use the new ones in chat, and update any node text that names the old ones): ${renumbered.join('; ')}` : '',
                events,
                `Map:\n${mapText(model, result.touchedAll)}`,
                model.queue.length ? `Queue:\n${queueText(model)}` : '',
                waitingText(model),
            ),
        }
    }

    /** The prompt hook: what the user did on the page since the agent was last told, or nothing. */
    function pending(where) {
        const at = locate(where)
        if (!at) return { text: '' }
        const ledger = readLedger(at.project, at.file)
        const events = takeEvents(ledger)
        if (!events) return { text: '' }
        writeLedger(at.project, at.file, ledger)
        return { text: `[outline "${headersOf(at).title || at.file}"] ${events}` }
    }

    /**
     * The hook after compaction or resume: the agent's picture of the outline is gone, so it gets the map again, and
     * every node counts as unseen until it reads it.
     */
    function reload(where) {
        const at = locate(where)
        if (!at) return { text: '' }
        const model = readModel(at.project, at.file)
        const ledger = readLedger(at.project, at.file)
        ledger.shown = {}
        const events = takeEvents(ledger)
        writeLedger(at.project, at.file, ledger)
        const map = mapText(model)
        return {
            text: sections(
                `This conversation is mirrored into the outline "${model.headers.title || at.file}" (${urlOf(at)}) with the outline tools: keep doing so after each answer, with one change call. Your picture of it did not survive: this is its map. Read a node before you update it.`,
                map ? `Map:\n${map}` : 'It has no nodes yet.',
                model.queue.length ? `Queue:\n${queueText(model)}` : '',
                events,
            ),
        }
    }

    /** The user's ticks on the page (`set`: `{ num, approved }` per node) or a press of Run (`run`: a node number). */
    async function act(project, file, { set, run }) {
        const model = readModel(project, file)
        const ledger = readLedger(project, file)
        const at = Date.now()
        if (set !== undefined) {
            const events = applyUserSet(model, set)
            normalize(model)
            writeModel(project, file, model)
            for (const e of events) ledger.events.push({ at, ...e })
        }
        let typed = false
        if (run !== undefined) {
            const node = findNode(model, String(run))
            if (!node || !node.action || node.action === 'done') throw new OpError(`${run} is not an action waiting to run`)
            const title = `${node.option ? `(${node.option}) ` : ''}${node.title}`
            // A session terminal takes the request now; without one the agent learns of it with the user's next message.
            if (model.headers.terminal && typeInto) {
                try {
                    await typeInto(model.headers.terminal, `Run in the outline: ${node.num} ${title.replace(/\.$/, '')}.`)
                    typed = true
                } catch (e) {
                    console.error(`run ${project}/${file} ${run}: ${e.message}`)
                }
            }
            if (!typed) ledger.events.push({ at, kind: 'run', num: node.num, title })
        }
        ledger.events = ledger.events.slice(-MAX_EVENTS)
        writeLedger(project, file, ledger)
        return { typed }
    }

    /** Something the user did to the outline outside its nodes (renaming it), for the agent to be told. */
    function userEvent(project, file, event) {
        const ledger = readLedger(project, file)
        if (event.kind === 'renamed') ledger.untitled = false
        ledger.events.push({ at: Date.now(), num: '', ...event })
        writeLedger(project, file, ledger)
    }

    /** The agent's messages of an outline, as the page's inbox reads them: `{ id, at, num, html }`. */
    const messages = (project, file) => readLedger(project, file).messages.map(m => ({ id: m.id, at: m.at, num: m.num, html: renderPlain(m.text) }))

    /** Runs a tool and answers `{ ok, text, … }`: a refusal is a result the agent reads, not a failed request. */
    const tool = fn => body => {
        try {
            return { ok: true, ...fn(body ?? {}) }
        } catch (e) {
            if (e instanceof Refusal) return { ok: false, text: e.message }
            throw e
        }
    }

    return { start: tool(start), read: tool(read), change: tool(change), pending, reload, act, userEvent, messages }
}
