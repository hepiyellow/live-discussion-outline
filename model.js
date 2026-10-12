import crypto from 'node:crypto'
import { HEAD_RE, OPTION_RE, TAG_RE, TRAIL_MARK, extractHeaders } from './outline.js'

// The outline as the server owns it (docs/adr/0003): the markdown file read into nodes, the operations an agent's
// `change` and the user's clicks apply to them, the rules the server keeps on its own (numbers, roll-up, the current
// node, the queue), and the file written back. outline.js stays the one reader for the page.

/** Nodes nest at most six levels deep (a markdown heading has no seventh). */
const MAX_LEVEL = 6
const NUM_RE = /^\d+(\.\d+)*$/

/** An operation the server refuses: why, and what to do about it. `text` is the node as it is now, for a stale update. */
export class OpError extends Error {
    constructor(reason, hint = '', text = '') {
        super(reason)
        this.hint = hint
        this.text = text
    }
}

const fenceOf = line => line.trimStart().match(/^(```|~~~)/)?.[1]

/** Calls `each(line, inFence)` for every line, knowing which lines sit inside a code fence. */
function walkLines(lines, each) {
    let fence = ''
    for (const line of lines) {
        const mark = fenceOf(line)
        const inside = !!fence
        if (mark && !fence) fence = mark
        else if (mark && mark === fence) fence = ''
        each(line, inside || !!fence)
    }
}

const HEADING = /^(#{1,6}) +(.*)$/

function blankNode(level) {
    return { num: '', level, title: '', approved: false, claim: false, asks: false, question: false, option: '', recommended: false, current: false, task: '', text: '', summary: '', recommendation: '', taskLine: '', children: [] }
}

/** A heading line's number, tags and title, as a node without text. */
function headingNode(content, level) {
    const node = blankNode(level)
    const m = content.trim().match(HEAD_RE)
    let rest = m ? m[2] : content.trim()
    node.num = m ? m[1] : ''
    for (let t; (t = rest.match(TAG_RE)); rest = rest.slice(t[0].length)) {
        const name = t[1].toLowerCase()
        const letter = name.match(OPTION_RE)
        if (letter) node.option = letter[1].toUpperCase()
        else if (name === 'user-approved' || name === 'approved') node.approved = true
        else if (name === 'agent-claim' || name === 'claim') node.claim = true
        else if (name === 'asks-approval') node.asks = true
        else if (name === 'options') node.question = true
        else if (name === 'recommended') node.recommended = true
        else if (name === 'current') node.current = true
        // A task, under its name and under the one it had before, action.
        else if (name === 'task-done' || name === 'action-done' || name === 'ran') node.task = 'done'
        else if (name === 'task-failed' || name === 'action-failed') node.task = 'failed'
        else if (name === 'task' || name === 'action') node.task ||= 'proposed'
    }
    node.title = rest.trim()
    return node
}

const CLOSING = { summary: 'summary', recommendation: 'recommendation', task: 'taskLine', action: 'taskLine' }

/** A node's text and its closing lines: the paragraphs at its end that start with `@Summary.`, `@Recommendation.` or `@Task.` (`@Action.` in older outlines). */
function splitBody(lines) {
    // Paragraphs as line ranges; a code fence is one paragraph whatever blank lines it holds.
    const paragraphs = []
    let open = null
    let i = 0
    walkLines(lines, (line, inFence) => {
        if (!inFence && !line.trim()) open = null
        else if (open) open.end = i + 1
        else paragraphs.push((open = { start: i, end: i + 1 }))
        i++
    })
    const closing = { summary: '', recommendation: '', taskLine: '' }
    let end = lines.length
    while (paragraphs.length) {
        const { start, end: stop } = paragraphs.at(-1)
        const text = lines.slice(start, stop).join('\n').trim()
        if (!/^@(summary|recommendation|task|action)\./i.test(text)) break
        const marks = [...text.matchAll(TRAIL_MARK)]
        marks.forEach((m, k) => {
            const field = CLOSING[m[1].toLowerCase()]
            closing[field] ||= text.slice(m.index + m[0].length, k + 1 < marks.length ? marks[k + 1].index : text.length).trim()
        })
        paragraphs.pop()
        end = start
    }
    return { text: lines.slice(0, end).join('\n').trim(), ...closing }
}

/**
 * An outline's text as a model: its header lines, the text before the first topic, its nodes as a tree, and its queue:
 * the pending actions in the agent's order, `placed` on an item once the agent gave it a place.
 */
export function parseOutline(text) {
    const { source, queue, ...headers } = extractHeaders(text.replace(/\r\n/g, '\n'))
    const root = { level: 0, children: [], lines: [] }
    const stack = [root]
    walkLines(source.split('\n'), (line, inFence) => {
        const m = !inFence && line.match(HEADING)
        if (!m) return stack.at(-1).lines.push(line)
        const node = headingNode(m[2], m[1].length)
        node.lines = []
        while (stack.at(-1).level >= node.level) stack.pop()
        stack.at(-1).children.push(node)
        stack.push(node)
    })
    const finish = node => {
        Object.assign(node, splitBody(node.lines))
        delete node.lines
        node.children.forEach(finish)
    }
    root.children.forEach(finish)
    const model = {
        headers,
        intro: root.lines.join('\n').trim(),
        nodes: root.children,
        // The reader names the item that asks to run a task as the page knows it, `action`: here it is a run item.
        queue: queue.map(({ num, kind, label, unplaced }) => ({ num, kind: kind === 'action' ? 'run' : kind, label, placed: !unplaced })),
    }
    // An outline from when the agent chose what to queue: an approval it queued is a request on that node from here on.
    const index = indexOf(model)
    for (const item of model.queue) if (item.kind === 'approve' && index.has(item.num)) index.get(item.num).node.asks = true
    return model
}

function headingLine(node) {
    const tags = [
        node.approved && '@user-approved',
        node.claim && '@agent-claim',
        node.asks && '@asks-approval',
        node.current && '@current',
        node.question && '@options',
        node.recommended && '@recommended',
        node.option && `@option_${node.option}`,
        node.task === 'proposed' && '@task',
        node.task === 'done' && '@task-done',
        node.task === 'failed' && '@task-failed',
    ].filter(Boolean)
    const num = node.num ? `${node.num}${node.level === 1 ? '.' : ''}` : ''
    return `${'#'.repeat(node.level)} ${[num, ...tags, node.title].filter(Boolean).join(' ')}`
}

/** The model as the outline's text: what the page's reader (outline.js) and the Markdown tab read. */
export function serializeOutline(model) {
    const { title, resume, model: agentModel, terminal, session, mode, workflow, archived } = model.headers
    // File mode has no line: a file without one is its agent's to write.
    const out = [['Title', title], ['Resume', resume], ['Model', agentModel], ['Terminal', terminal], ['Session', session], ['Mode', mode === 'server' ? mode : ''], ['Workflow', workflow], ['Archived', archived]]
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
    out.push('')
    if (model.intro) out.push(model.intro, '')
    const write = node => {
        out.push(headingLine(node), '')
        if (node.text) out.push(node.text, '')
        if (node.summary) out.push(`@Summary. ${node.summary}`, '')
        if (node.recommendation) out.push(`@Recommendation. ${node.recommendation}`, '')
        if (node.taskLine) out.push(`@Task. ${node.taskLine}`, '')
        node.children.forEach(write)
    }
    model.nodes.forEach(write)
    if (model.queue.length) {
        out.push('# @queue')
        for (const item of model.queue) out.push(`- ${item.num} @${item.kind}${item.placed ? '' : ' @unplaced'} ${item.label}`.trimEnd())
        out.push('')
    }
    return out.join('\n')
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the model

/** Every node, parents before children. */
export function allNodes(nodes, out = []) {
    for (const n of nodes) {
        out.push(n)
        allNodes(n.children, out)
    }
    return out
}

/** Each numbered node with its parent (undefined for a topic), by number; the first node wins a number used twice. */
function indexOf(model) {
    const index = new Map()
    const walk = (nodes, parent) =>
        nodes.forEach(n => {
            if (n.num && !index.has(n.num)) index.set(n.num, { node: n, parent })
            walk(n.children, n)
        })
    walk(model.nodes)
    return index
}

export const findNode = (model, num) => indexOf(model).get(num)?.node

/** A question with its options under it (as outline.js `isQuestion`). */
export const isQuestion = node => node.children.length > 0 && (node.question || node.children.some(c => c.option))

/** A node's own status: user-approved, a claim (also what a recommendation makes it), or open. */
const ownStatus = node => (node.approved ? 'approved' : node.claim || node.recommended || node.recommendation ? 'claim' : 'open')

const questionStatus = node => (node.children.some(c => c.approved) ? 'approved' : node.children.some(c => ownStatus(c) === 'claim') ? 'claim' : 'open')

/** The statuses under a node, of the nodes that hold one of their own: its leaves, and each question as one. */
function statusesUnder(node, seen = new Set()) {
    for (const n of node.children) {
        if (isQuestion(n)) seen.add(questionStatus(n))
        else if (n.children.length) statusesUnder(n, seen)
        // A task takes no approval: one still to run (or to run again) is open, and one carried out waits for nothing.
        else if (n.task) n.task !== 'done' && seen.add('open')
        else seen.add(ownStatus(n))
    }
    return seen
}

/** A task takes no approval; an option that is a task is picked like any other option, and a pick is not an approval. */
const takesNoApproval = (node, parent) => !!node.task && !(parent && isQuestion(parent))

/** The status a node shows: its own for a leaf, a question's from its options, a parent's from what is under it. */
export function statusOf(node) {
    if (isQuestion(node)) return questionStatus(node)
    return ownStatus(node)
}

const label = node => `${node.num} ${node.option ? `(${node.option}) ` : ''}${node.title}`

/** What a node is, in the glossary's words, for the map and for reads. */
function describe(node, parent) {
    const parts = []
    if (parent && isQuestion(parent)) parts.push(node.approved ? 'option, picked' : node.recommended ? 'option, recommended' : 'option')
    else if (isQuestion(node)) parts.push(`question, ${{ approved: 'answered', claim: 'has a recommendation', open: 'open' }[questionStatus(node)]}`)
    else parts.push({ approved: 'user-approved', claim: 'claim', open: 'open' }[ownStatus(node)])
    if (node.task) parts.push({ proposed: 'task', done: 'task done', failed: 'task failed' }[node.task])
    if (node.asks && !node.approved) parts.push('asks approval')
    return parts.join(', ')
}

/** Above this many nodes the map shows the topics and what is around the nodes asked for, not everything. */
const MAP_ALL = 80

/**
 * The map: one line per node with its number, what it is and its title, indented by depth. A large outline shows its
 * topics and the surroundings of `around` (their ancestors, siblings and children), and counts the rest.
 */
export function mapText(model, around = []) {
    const index = indexOf(model)
    const total = allNodes(model.nodes).length
    const shown = new Set()
    if (total > MAP_ALL) {
        for (const num of around) {
            const parts = num.split('.')
            for (let i = 1; i <= parts.length; i++) shown.add(parts.slice(0, i).join('.'))
            const entry = index.get(num)
            for (const n of entry?.node.children ?? []) shown.add(n.num)
            for (const n of entry?.parent?.children ?? []) shown.add(n.num)
        }
    }
    const lines = []
    const walk = (nodes, parent, depth) => {
        let hidden = 0
        for (const n of nodes) {
            if (total > MAP_ALL && depth > 0 && !shown.has(n.num)) {
                hidden += allNodes([n]).length
                continue
            }
            lines.push(`${'  '.repeat(depth)}${label(n)} [${describe(n, parent)}]${n.current ? ' <- current' : ''}`)
            walk(n.children, n, depth + 1)
        }
        if (hidden) lines.push(`${'  '.repeat(depth)}… ${hidden} more under ${parent.num} (read ${parent.num} to see them)`)
    }
    walk(model.nodes, undefined, 0)
    return lines.join('\n')
}

/** One node in full, as `read` returns it. */
function nodeText(node, parent) {
    const lines = [`${label(node)} [${describe(node, parent)}]`]
    if (node.text) lines.push(node.text)
    if (node.summary) lines.push(`Summary: ${node.summary}`)
    if (node.recommendation) lines.push(`Recommendation: ${node.recommendation}`)
    if (node.taskLine) lines.push(`Task: ${node.taskLine}`)
    return lines.join('\n')
}

/** A node and its descendants in full (or every node), as compact text; and the nodes it showed. */
export function readText(model, num = '') {
    const index = indexOf(model)
    const entry = num ? index.get(num) : undefined
    if (num && !entry) throw new OpError(`There is no node ${num}.`, 'Call read without a number to see every node.')
    const shown = []
    const blocks = []
    const walk = (nodes, parent) =>
        nodes.forEach(n => {
            shown.push(n)
            blocks.push(nodeText(n, parent))
            walk(n.children, n)
        })
    if (entry) walk([entry.node], entry.parent)
    else walk(model.nodes)
    return { text: blocks.join('\n\n'), shown }
}

/** The queue as the agent reads it: the pending actions in order, each with what it asks, and whether it has a place yet. */
export function queueText(model) {
    return model.queue.map(item => `${item.num} [${item.kind}${item.placed ? '' : ', not placed'}] ${item.label}`).join('\n')
}

/** The hash of what an agent writes of a node: an update is stale when this changed since the agent last saw the node. */
export const nodeHash = node => crypto.createHash('sha1').update(JSON.stringify([node.title, node.text, node.summary, node.recommendation, node.taskLine])).digest('hex').slice(0, 12)

/** A node is a claim or a task, never both: what the agent is told when a change would make one node both. */
const ONE_KIND = 'A node is a claim or a task, never both'

/** What a node is on the agent's side, as the action log names it: a task (proposed), done, failed, an option, a claim, or plain. */
const kindOf = (node, parent) =>
    node.task === 'done' ? 'done' : node.task === 'failed' ? 'failed' : node.task ? 'task' : parent && isQuestion(parent) ? 'option' : node.claim || node.recommendation ? 'claim' : 'plain'

/**
 * An entry of the action log for something the user did on a node (`what`: approved, took-back, picked or ran): the
 * node's number and title, the kind it had and the hash of the wording the user saw. Undefined when there is no such node.
 */
export function userEntry(model, num, what) {
    const found = indexOf(model).get(num)
    return found && { num, what, kind: kindOf(found.node, found.parent), hash: nodeHash(found.node), title: found.node.title }
}

/**
 * The action a node waits for the user to perform, or '' when it waits for none: `run` for a task still to run (or
 * one that failed and can be run again), `decide` for a question the agent recommends no option for, `approve` for a
 * claim (a question with a recommended option is one) whose agent asked the user to approve it. Nothing requires an
 * approval, so a claim that does not ask for one waits for nothing.
 */
function pendingKind(node) {
    if (node.task) return node.task === 'done' ? '' : 'run'
    const status = isQuestion(node) ? questionStatus(node) : node.children.length ? parentStatus(node) : ownStatus(node)
    if (isQuestion(node) && status === 'open') return 'decide'
    return node.asks && status === 'claim' ? 'approve' : ''
}

/**
 * The pending actions of an outline, in outline order: `{ num, kind }` for each node that waits for the user. The
 * server reads them off the nodes; the agent only orders them (the queue). An option waits for nothing by itself: its
 * question does, until the user picks one, and then the picked option's task is the one to run.
 */
export function pendingActions(model) {
    const out = []
    const walk = (nodes, parent) => {
        const options = !!parent && isQuestion(parent)
        for (const n of nodes) {
            if (options && !n.approved) continue
            const kind = options ? (n.task && n.task !== 'done' ? 'run' : '') : pendingKind(n)
            if (kind) out.push({ num: n.num, kind })
            walk(n.children, n)
        }
    }
    walk(model.nodes)
    return out
}

function parentStatus(node) {
    const seen = statusesUnder(node)
    // Nothing under it takes an approval or is still to run: it asks nothing.
    if (!seen.size) return 'approved'
    if (seen.size === 1) return [...seen][0]
    return seen.has('open') ? 'open' : 'claim'
}

// ---------------------------------------------------------------------------------------------------------------------
// The rules the server keeps on its own

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * After any change: options are lettered in order, statuses roll up (a question is approved once an option is picked; a
 * parent takes the status its descendants share), `current` marks the one node last touched, and the queue is the
 * pending actions: those it held keep their order, those it did not hold yet come last, not placed, and those whose
 * node waits for nothing more are dropped. Returns the dropped items.
 */
export function normalize(model, touched = '') {
    const roll = (node, parent) => {
        node.children.forEach(c => roll(c, node))
        if (isQuestion(node)) {
            node.question = true
            node.children.forEach((c, i) => {
                // An older outline types the letter into the title: the tag carries it from here on.
                if (!c.option) c.title = c.title.replace(/^\([A-Z]\)\s+/, '')
                c.option = LETTERS[i] ?? 'Z'
            })
            node.approved = node.children.some(c => c.approved)
            return
        }
        // An option's tick is the user's pick of it, whatever stands under it.
        if (!node.children.length || (parent && isQuestion(parent))) return
        const seen = statusesUnder(node)
        node.approved = seen.size === 1 && seen.has('approved')
        // A parent that is itself a task stays one: a node is never a claim and a task at once.
        node.claim = !node.task && !node.approved && seen.size > 0 && !seen.has('open')
    }
    model.nodes.forEach(n => roll(n))

    const index = indexOf(model)
    if (touched && index.has(touched)) for (const n of allNodes(model.nodes)) n.current = n.num === touched
    const current = allNodes(model.nodes).filter(n => n.current)
    current.slice(0, -1).forEach(n => (n.current = false))

    const pending = new Map(pendingActions(model).map(p => [p.num, p.kind]))
    const item = (num, placed) => ({ num, kind: pending.get(num), label: index.get(num).node.title, placed })
    const dropped = []
    const seen = new Set()
    const queue = []
    for (const held of model.queue) {
        if (pending.has(held.num) && !seen.has(held.num)) queue.push(item(held.num, held.placed !== false))
        else dropped.push({ ...held, gone: !index.has(held.num) })
        seen.add(held.num)
    }
    for (const num of pending.keys()) if (!seen.has(num)) queue.push(item(num, false))
    model.queue = queue
    return dropped
}

// ---------------------------------------------------------------------------------------------------------------------
// Operations

const isText = v => typeof v === 'string'

function checkTitle(title, where) {
    if (!isText(title) || !title.trim()) throw new OpError(`${where} needs a title.`, 'Give a short title of 2 to 8 words.')
    if (/\n/.test(title.trim())) throw new OpError(`The title of ${where} runs over several lines.`, 'A title is one short line; the rest goes in text.')
    if (title.trim().length > 200) throw new OpError(`The title of ${where} is longer than 200 characters.`, 'Keep the title short and put the rest in text.')
    if (/^@\w/.test(title.trim())) throw new OpError(`The title of ${where} starts with a tag.`, 'Tags are not written: use status, options, recommended and task.')
    return title.trim().replace(/^#+\s*/, '')
}

function checkText(text, where, field = 'text') {
    if (text === undefined || text === null) return undefined
    if (!isText(text)) throw new OpError(`The ${field} of ${where} is not text.`)
    walkLines(text.split('\n'), (line, inFence) => {
        if (inFence) return
        if (HEADING.test(line)) throw new OpError(`The ${field} of ${where} has a heading line (${line.trim().slice(0, 40)}).`, 'A heading would become a node of its own: add a child node instead, or use bold text.')
        if (/^\s*@(summary|recommendation|task|action)\./i.test(line)) throw new OpError(`The ${field} of ${where} has a closing line written into it.`, 'Pass summary, recommendation and task as their own fields.')
    })
    return text.trim()
}

function checkLine(value, where, field) {
    const text = checkText(value, where, field)
    if (text && /\n\s*\n/.test(text)) throw new OpError(`The ${field} of ${where} has more than one paragraph.`, `A ${field} is one or two sentences.`)
    return text
}

/** A task line stands beside the button that runs the task: one short sentence. The details are the node's text. */
const TASK_MAX = 100

function checkTask(value, where) {
    const line = checkLine(value, where, 'task')
    if (line && line.length > TASK_MAX)
        throw new OpError(`The task of ${where} is ${line.length} characters long, and a task line has at most ${TASK_MAX}.`, 'Say in one short sentence what you will do, without file names, and put the details in the node’s text.')
    return line
}

/**
 * `ask` on a node: the agent asks the user to approve it, which makes it a pending action while it is a claim the user
 * has not approved. A task takes no approval, and an option is picked, not approved: its question is what asks.
 */
function checkAsk(value, node, option, where) {
    if (typeof value !== 'boolean') throw new OpError(`The ask of ${where} is ${JSON.stringify(value)}.`, 'ask is true or false.')
    if (value && node.task) throw new OpError(`${where} is a task, and a task takes no approval.`, 'A task to run is a pending action by itself. To ask approval of a claim about it, state the claim in a node of its own.')
    if (value && option) throw new OpError(`${where} is an option, and an option is picked, not approved.`, 'Set ask on its question: the user then answers by picking.')
    return value
}

/** A new node from an `add` (or one of its children, or an option of its question). */
function buildNode(spec, num, level, option = '') {
    const where = `node ${num}`
    if (!spec || typeof spec !== 'object') throw new OpError(`${where} is not an object.`)
    if (level > MAX_LEVEL) throw new OpError(`${where} would be ${level} levels deep; nodes nest at most ${MAX_LEVEL}.`, 'Write it as bullets in its parent’s text, or add it higher up.')
    if (spec.num !== undefined && spec.num !== num) throw new OpError(`A child of ${num.split('.').slice(0, -1).join('.')} is numbered ${spec.num}, and its place makes it ${num}.`, 'Leave the numbers of children out: they are numbered in order.')
    const node = blankNode(level)
    node.num = num
    node.option = option
    node.title = checkTitle(spec.title, where)
    node.text = checkText(spec.text, where) ?? ''
    node.summary = checkLine(spec.summary, where, 'summary') ?? ''
    node.recommendation = checkLine(spec.recommendation, where, 'recommendation') ?? ''
    if (spec.status === 'approved' || spec.status === 'user-approved')
        throw new OpError(`${where} cannot be added as approved: only the user approves.`, 'Add it as a claim; if the user approved it in chat, follow with { op: "record", decision: "approve" }.')
    if (spec.status !== undefined && spec.status !== 'open' && spec.status !== 'claim') throw new OpError(`${where} has status ${JSON.stringify(spec.status)}.`, 'A status is "open" or "claim".')
    node.claim = spec.status === 'claim'
    // The field was called action before a task was called one: a session started then still sends it.
    const asked = spec.task ?? spec.action
    if (asked !== undefined && asked !== false) {
        const line = checkTask(asked === true ? '' : asked, where)
        if (!line) throw new OpError(`${where} is a task without saying what will be done.`, 'Set task to one sentence on what you will do when the user runs it.')
        node.task = 'proposed'
        node.taskLine = line
    }
    // The user asked in chat and the agent did it: the node comes in as a task already carried out.
    if (spec.outcome !== undefined || spec.failed) {
        if (spec.options !== undefined) throw new OpError(`The question ${num} is added with an outcome.`, 'A question is answered by a pick. Add what you did as a node of its own.')
        const outcome = checkText(spec.outcome, where, 'outcome')
        if (!outcome) throw new OpError(`${where} is added as a task you carried out, without its outcome.`, 'Set outcome to one or two sentences on what happened.')
        node.task = spec.failed ? 'failed' : 'done'
        node.text = [node.text, outcome].filter(Boolean).join('\n\n')
    }
    if (node.claim && node.task) throw new OpError(`${where} is added as a claim and as a task.`, `${ONE_KIND}: add the claim, and the task as a node of its own beside it.`)
    if (spec.ask !== undefined) node.asks = checkAsk(spec.ask, node, option, where)
    if (option) node.recommended = !!spec.recommended
    else if (spec.recommended) throw new OpError(`${where} is marked recommended, and it is not an option.`, 'For a recommendation on a node that is not a choice, use the recommendation field.')
    if (spec.options !== undefined) {
        if (!Array.isArray(spec.options) || spec.options.length < 2) throw new OpError(`The question ${num} needs at least two options.`, 'Give options as a list of { title, text }.')
        if (spec.children?.length) throw new OpError(`The question ${num} has both options and children.`, 'A question’s children are its options.')
        if (spec.options.filter(o => o?.recommended).length > 1) throw new OpError(`The question ${num} recommends more than one option.`, 'Recommend at most one.')
        if (spec.options.length > LETTERS.length) throw new OpError(`The question ${num} has too many options.`)
        node.question = true
        node.children = spec.options.map((o, i) => buildNode(o, `${num}.${i + 1}`, level + 1, LETTERS[i]))
    } else if (spec.children !== undefined) {
        if (!Array.isArray(spec.children)) throw new OpError(`The children of ${num} are not a list.`)
        node.children = spec.children.map((c, i) => buildNode(c, `${num}.${i + 1}`, level + 1))
    }
    return node
}

const nextNumber = (parentNum, siblings) => {
    const last = Math.max(0, ...siblings.map(s => Number(s.num.split('.').pop()) || 0))
    return parentNum ? `${parentNum}.${last + 1}` : String(last + 1)
}

/** Gives a node and everything under it a new number and level; `map` collects old → new for the numbers that changed. */
function renumber(node, num, level, map) {
    if (node.num && node.num !== num) map.set(node.num, num)
    node.num = num
    node.level = level
    node.children.forEach((c, i) => renumber(c, `${num}.${i + 1}`, level + 1, map))
}

const depthOf = node => 1 + Math.max(0, ...node.children.map(depthOf))

/**
 * Applies an agent's operations to the model, in order. `shown` holds the hash of each node as the agent last saw it
 * (for the stale-write guard) and is kept up to date. Throws an OpError naming the operation that broke a rule; the
 * caller applies the operations to a copy, so a refused change leaves nothing behind.
 *
 * Returns what the result reports: the node last touched, notes, the numbers that changed, the messages to post, and
 * what the user decided in chat (`decisions`: approval log entries, each with its `node`, whose number may change yet).
 */
export function applyOperations(model, ops, shown = {}) {
    if (!Array.isArray(ops) || !ops.length) throw new OpError('A change needs a list of operations.', 'Pass ops: [{ op: "add", … }, …].')
    const result = { touched: '', touchedAll: [], notes: [], renumbered: new Map(), messages: [], removed: [], decisions: [], ordered: [] }
    const touch = num => {
        result.touched = num
        result.touchedAll.push(num)
    }
    const get = (num, what = 'node') => {
        if (!isText(num) || !NUM_RE.test(num)) throw new OpError(`${JSON.stringify(num)} is not a node number.`, 'A number is a full path such as 2.1.3.')
        const entry = indexOf(model).get(num)
        if (!entry) throw new OpError(`There is no ${what} ${num}.`, `The nodes are:\n${mapText(model, [num.split('.').slice(0, -1).join('.')])}`)
        return entry
    }
    /** Moves the numbers that changed everywhere they are kept by number. */
    const renumbered = map => {
        if (!map.size) return
        for (const item of model.queue) item.num = map.get(item.num) ?? item.num
        result.ordered = result.ordered.map(num => map.get(num) ?? num)
        const moved = Object.entries(shown).map(([num, hash]) => [map.get(num) ?? num, hash])
        for (const key of Object.keys(shown)) delete shown[key]
        Object.assign(shown, Object.fromEntries(moved))
        // A number changed earlier in this change and again now: old → newest.
        const between = new Set(result.renumbered.values())
        for (const [from, to] of result.renumbered) if (map.has(to)) result.renumbered.set(from, map.get(to))
        for (const [from, to] of map) if (!between.has(from)) result.renumbered.set(from, to)
        result.touchedAll = result.touchedAll.map(n => map.get(n) ?? n)
        result.touched = map.get(result.touched) ?? result.touched
    }
    const closeGap = (siblings, parent) => {
        const map = new Map()
        siblings.forEach((s, i) => renumber(s, parent ? `${parent.num}.${i + 1}` : String(i + 1), s.level, map))
        return map
    }

    const apply = {
        add(op) {
            if (!isText(op.num) || !NUM_RE.test(op.num)) throw new OpError(`An add needs the number of the new node, and got ${JSON.stringify(op.num)}.`, 'Propose the full path, such as 2.4: the next free number under its parent.')
            const index = indexOf(model)
            if (index.has(op.num)) throw new OpError(`The number ${op.num} is taken by "${index.get(op.num).node.title}".`, `Update that node, or add the new one as ${nextNumber(op.num.split('.').slice(0, -1).join('.'), index.get(op.num).parent?.children ?? model.nodes)}.`)
            const parentNum = op.num.split('.').slice(0, -1).join('.')
            const parent = parentNum ? get(parentNum, 'parent').node : undefined
            const siblings = parent ? parent.children : model.nodes
            const next = nextNumber(parentNum, siblings)
            if (op.num !== next) throw new OpError(`${op.num} would skip numbers under ${parentNum || 'the outline'}.`, `The next free number there is ${next}.`)
            const option = parent && isQuestion(parent)
            if (parent && parent.question && !parent.children.length) throw new OpError(`${parentNum} is a question without options.`, 'Add its options as nodes under it.')
            const node = buildNode(op, op.num, (parent?.level ?? 0) + 1, option ? LETTERS[siblings.length] ?? 'Z' : '')
            siblings.push(node)
            if (option) result.notes.push(`${op.num} is option (${node.option}) of the question ${parentNum}.`)
            for (const n of allNodes([node])) shown[n.num] = nodeHash(n)
            touch(op.num)
        },

        update(op) {
            const { node, parent } = get(op.num)
            if (shown[op.num] !== nodeHash(node)) {
                shown[op.num] = nodeHash(node)
                const stale = new OpError(
                    `${op.num} changed since you last saw it (or you have not read it since your context was compacted), so the update was not applied.`,
                    'This is the node as it is now. Send the update again if it still holds, keeping what the node has and your change needs.',
                    nodeText(node, parent),
                )
                stale.num = op.num
                throw stale
            }
            const where = `node ${op.num}`
            const before = nodeHash(node)
            if (op.title !== undefined) node.title = checkTitle(op.title, where)
            if (op.text !== undefined) node.text = checkText(op.text, where) ?? ''
            if (op.summary !== undefined) node.summary = checkLine(op.summary, where, 'summary') ?? ''
            if (op.recommendation !== undefined) node.recommendation = checkLine(op.recommendation, where, 'recommendation') ?? ''
            // The field was called action before a task was called one.
            const asked = op.task ?? op.action
            if (asked !== undefined) {
                const line = asked === false ? '' : checkTask(asked, where)
                if (line && !node.task && !node.children.length && node.claim)
                    throw new OpError(`${op.num} is a claim, so it cannot become a task too.`, `${ONE_KIND}: add the task as a node of its own beside ${op.num}.`)
                node.taskLine = line ?? ''
                if (!line) node.task = ''
                else node.task ||= 'proposed'
            }
            if (op.ask !== undefined) node.asks = checkAsk(op.ask, node, parent && isQuestion(parent), where)
            if (op.recommended !== undefined) {
                if (!parent || !isQuestion(parent)) throw new OpError(`${op.num} is not an option, so it cannot be recommended.`, 'Use the recommendation field for a node that is not a choice.')
                if (op.recommended) parent.children.forEach(c => (c.recommended = false))
                node.recommended = !!op.recommended
            }
            if (op.status !== undefined) {
                if (op.status !== 'open' && op.status !== 'claim')
                    throw new OpError(`An update can make ${op.num} open or a claim, not ${JSON.stringify(op.status)}.`, 'Only the user approves: when they did so in chat, use { op: "record", decision: "approve" }.')
                if (node.children.length) throw new OpError(`${op.num} has nodes under it, so its status follows theirs.`, 'Set the status of the nodes under it.')
                if (op.status === 'claim' && node.task && !node.claim) throw new OpError(`${op.num} is a task, so it cannot be a claim too.`, `${ONE_KIND}: state the claim in a node of its own beside ${op.num}.`)
                if (node.approved) result.notes.push(`${op.num} was user-approved; you set its status, so the user's approval no longer stands.`)
                node.approved = false
                node.claim = op.status === 'claim'
            }
            // A task takes no approval: one that an older outline left on it goes.
            if (takesNoApproval(node, parent)) node.approved = false
            // The user approved the words that were there: new words are the agent's again until the user approves them.
            if (node.approved && nodeHash(node) !== before && !(parent && isQuestion(parent))) {
                node.approved = false
                // A task stays a task: a node is never both.
                node.claim = !node.task
                result.notes.push(`${op.num} was user-approved; its wording changed, so ${node.task ? 'the approval no longer stands' : 'it is a claim again'} until the user approves the new wording.`)
            }
            shown[op.num] = nodeHash(node)
            touch(op.num)
        },

        move(op) {
            const { node, parent } = get(op.num)
            const under = op.under === undefined || op.under === '' || op.under === null ? '' : op.under
            const target = under ? get(under, 'parent').node : undefined
            if (under && (under === op.num || under.startsWith(`${op.num}.`))) throw new OpError(`${op.num} cannot move under itself.`)
            if (target === parent) throw new OpError(`${op.num} is already under ${under || 'the outline'}.`)
            const level = (target?.level ?? 0) + 1
            if (level + depthOf(node) - 1 > MAX_LEVEL) throw new OpError(`Under ${under}, ${op.num} and its nodes would be deeper than ${MAX_LEVEL} levels.`, 'Move it higher up, or fold its deepest nodes into bullets first.')
            const from = parent ? parent.children : model.nodes
            const to = target ? target.children : model.nodes
            const wasOption = parent && isQuestion(parent)
            from.splice(from.indexOf(node), 1)
            const map = closeGap(from, parent)
            // An option that leaves its question is no longer a pick or a recommendation; normalize letters it anew.
            if (wasOption) node.approved = false
            node.option = ''
            node.recommended = false
            renumber(node, nextNumber(target?.num ?? '', to), level, map)
            to.push(node)
            renumbered(map)
            touch(node.num)
        },

        remove(op) {
            const { node, parent } = get(op.num)
            const from = parent ? parent.children : model.nodes
            from.splice(from.indexOf(node), 1)
            const gone = allNodes([node]).map(n => n.num)
            result.removed.push(...gone)
            for (const num of gone) delete shown[num]
            model.queue = model.queue.filter(item => !gone.includes(item.num))
            result.ordered = result.ordered.filter(num => !gone.includes(num))
            renumbered(closeGap(from, parent))
            result.touchedAll = result.touchedAll.filter(n => !gone.includes(n))
            if (parent) touch(parent.num)
            else result.touched = ''
        },

        record(op) {
            const { node, parent } = get(op.num)
            const option = parent && isQuestion(parent)
            if (op.decision === 'pick') {
                if (!option) throw new OpError(`${op.num} is not an option of a question.`, 'To record an approval of a node, use decision "approve".')
                parent.children.forEach(c => (c.approved = false))
                node.approved = true
                result.decisions.push({ ...userEntry(model, node.num, 'picked'), node })
            } else if (op.decision === 'approve') {
                if (option) throw new OpError(`${op.num} is an option.`, 'Record the user’s choice with decision "pick".')
                if (isQuestion(node)) throw new OpError(`${op.num} is a question: the user answers it by picking an option.`, 'Record the option they picked with decision "pick".')
                if (node.task) throw new OpError(`${op.num} is a task, and a task takes no approval.`, 'The user runs a task and reads what came of it. If what they approved is a claim about it, state that claim in a node of its own beside it and record the approval there.')
                const leaves = node.children.length ? leavesToApprove(node) : [node]
                for (const n of leaves) {
                    if (!n.approved) result.decisions.push({ ...userEntry(model, n.num, 'approved'), node: n })
                    n.approved = true
                }
            } else if (op.decision === 'reopen') {
                for (const n of allNodes([node])) {
                    // A parent's tick follows what is under it: what the user took back is each node's own.
                    if (n.approved && (!n.children.length || n.option)) result.decisions.push({ ...userEntry(model, n.num, 'took-back'), node: n })
                    n.approved = false
                }
            } else throw new OpError(`A record's decision is "approve", "reopen" or "pick", not ${JSON.stringify(op.decision)}.`)
            touch(op.num)
        },

        finish(op) {
            const { node, parent } = get(op.num)
            // A node that was never proposed as a task is finished too: the user asked for it in chat, and it is done.
            if (isQuestion(node)) throw new OpError(`${op.num} is a question: the user answers it by picking an option.`, 'Finish the option you carried out, or add what you did as a node with its outcome.')
            const outcome = checkText(op.outcome, `node ${op.num}`, 'outcome')
            if (!outcome) throw new OpError(`Finishing ${op.num} needs its outcome.`, 'Say in one or two sentences what happened; add a child node for anything long.')
            // Done says the whole node is carried out, and only the agent knows what became of the tasks under it.
            const unsettled = op.failed ? [] : unsettledTasks(node)
            if (unsettled.length)
                throw new OpError(
                    `${op.num} has ${unsettled.length === 1 ? 'a task' : 'tasks'} under it that ${unsettled.length === 1 ? 'is' : 'are'} not settled: ${unsettled.map(n => `${label(n)} (${n.task === 'failed' ? 'failed' : 'not run'})`).join('; ')}.`,
                    `Settle each one before ${op.num}, in this same change: finish it with its outcome if you carried it out, finish it with failed if you tried and could not, or, when it is no longer needed, take its task off ({ op: "update", task: "" }) and say why in its text.`,
                )
            if (!node.task && !node.children.length && node.claim)
                throw new OpError(`${op.num} is a claim, so it is not finished as a task.`, `${ONE_KIND}: add what you did as a node of its own beside ${op.num}, with its outcome.`)
            node.task = op.failed ? 'failed' : 'done'
            node.text = [node.text, outcome].filter(Boolean).join('\n\n')
            // A task takes no approval: one that an older outline left on it goes. An option's tick is the user's pick, which stands.
            if (takesNoApproval(node, parent)) node.approved = false
            shown[op.num] = nodeHash(node)
            touch(op.num)
        },

        // The agent took in the user's ticks and nothing in the outline follows from them: any change says so (agent.js),
        // and this operation makes a change that holds nothing else.
        acknowledge() {},

        message(op) {
            if (!isText(op.text) || !op.text.trim()) throw new OpError('A message needs its text.')
            if (op.text.length > 2000) throw new OpError('A message is one or two sentences; this one is longer than 2000 characters.', 'What is long belongs in a node.')
            if (op.num !== undefined && op.num !== '') get(op.num)
            result.messages.push({ num: op.num || '', text: op.text.trim() })
        },

        // The queue's order, and nothing else: which nodes are in it the server reads off the nodes (normalize). The
        // nodes listed come first, in this order, and have their place; a pending action left out keeps the place it had.
        queue(op) {
            if (!Array.isArray(op.items)) throw new OpError('A queue needs its items.', 'Pass items: [{ num }, …]: the pending actions, most important first.')
            const seen = new Set()
            const order = op.items.map(item => {
                const num = isText(item) ? item : item?.num
                get(num)
                if (seen.has(num)) throw new OpError(`${num} is in the queue twice.`)
                seen.add(num)
                return num
            })
            const held = new Map(model.queue.map(item => [item.num, item]))
            model.queue = [...order.map(num => ({ ...(held.get(num) ?? { num, kind: '', label: '' }), placed: true })), ...model.queue.filter(item => !seen.has(item.num))]
            result.ordered.push(...order.filter(num => !result.ordered.includes(num)))
        },
    }

    ops.forEach((op, i) => {
        const run = op && typeof op === 'object' ? apply[op.op] : undefined
        try {
            if (!run) throw new OpError(`${JSON.stringify(op?.op)} is not an operation.`, `The operations are ${Object.keys(apply).join(', ')}.`)
            run(op)
        } catch (e) {
            if (e instanceof OpError) e.message = `Operation ${i + 1} of ${ops.length} (${op?.op ?? '?'}${op?.num ? ` ${op.num}` : ''}): ${e.message}`
            throw e
        }
    })
    return result
}

/**
 * The tasks under a node that the agent has neither carried out nor given up: proposed or failed. An option counts
 * only once the user picked it: which option to take is the user's to say, and one not picked is not waiting to run.
 */
function unsettledTasks(node, out = []) {
    const question = isQuestion(node)
    for (const n of node.children) {
        if (question && !n.approved) continue
        if (n.task === 'proposed' || n.task === 'failed') out.push(n)
        unsettledTasks(n, out)
    }
    return out
}

/** What approving a parent approves: the leaves under it, leaving questions (the user picks those) and tasks (they take no approval) as they are. */
function leavesToApprove(node, out = []) {
    for (const n of node.children) {
        if (isQuestion(n)) continue
        if (n.children.length) leavesToApprove(n, out)
        else if (!n.task) out.push(n)
    }
    return out
}

/**
 * Applies what the user did on the page: `set` is a list of `{ num, approved }`, one per node whose tick changed.
 * Returns the events the agent is told about: `{ kind: 'approved' | 'picked' | 'reopened', num, title }`.
 */
export function applyUserSet(model, set) {
    if (!Array.isArray(set)) throw new OpError('set takes a list')
    const index = indexOf(model)
    const events = []
    for (const change of set) {
        const entry = index.get(change?.num)
        if (!entry || typeof change.approved !== 'boolean') throw new OpError(`no node ${change?.num}`)
        const { node, parent } = entry
        const option = parent && isQuestion(parent)
        // A task takes no approval: a tick sent for one is not recorded, and one an older outline left on it goes.
        if (takesNoApproval(node, parent)) {
            node.approved = false
            continue
        }
        if (node.approved === change.approved) continue
        node.approved = change.approved
        // A question's own tick follows its options, and a parent's follows what is under it: neither is an event.
        if (isQuestion(node) || (node.children.length && !option)) continue
        events.push({ kind: change.approved ? (option ? 'picked' : 'approved') : 'reopened', num: node.num, title: `${node.option ? `(${node.option}) ` : ''}${node.title}` })
    }
    return events
}
