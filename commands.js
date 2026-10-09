import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findTranscriptFile } from './transcript.js'

// Slash commands for the message box's autocomplete: the skills the session itself lists, the user-only skills and
// commands on disk, and a short list of Claude Code's built-in commands.

const HOME = os.homedir()

// Built-ins can't be read from anywhere, so this list is kept short and may lag behind Claude Code.
const BUILTINS = [
    { name: 'model', hint: '[model]', description: 'Switch the model (no argument opens a picker in the Terminal tab).' },
    { name: 'effort', hint: '[low|medium|high|xhigh|max]', description: 'Set the reasoning effort.' },
    { name: 'compact', hint: '[instructions]', description: 'Summarize the conversation so far to free context.' },
    { name: 'clear', description: 'Start a new conversation (the outline keeps pointing at the old one).' },
    { name: 'rename', hint: '[name]', description: 'Name this session.' },
    { name: 'context', description: 'Show what fills the context window.' },
    { name: 'resume', description: 'Pick a past conversation (opens in the Terminal tab).' },
    { name: 'mcp', description: 'Manage MCP servers (opens in the Terminal tab).' },
    { name: 'memory', description: 'Edit memory files (opens in the Terminal tab).' },
    { name: 'config', description: 'Open settings (opens in the Terminal tab).' },
    { name: 'help', description: 'Show help.' },
].map(c => ({ ...c, source: 'built-in' }))

/** The skills the session was told about, from the `skill_listing` entries in its transcript. */
function sessionSkills(sessionId) {
    const file = sessionId && findTranscriptFile(sessionId)
    if (!file) return []
    const out = new Map()
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('"skill_listing"')) continue
        let e
        try {
            e = JSON.parse(line)
        } catch {
            continue
        }
        const { names = [], content = '' } = e.attachment || {}
        for (const name of names) {
            const at = content.indexOf(`- ${name}: `)
            const description = at < 0 ? '' : content.slice(at + name.length + 4).split('\n')[0]
            out.set(name, { name, description, source: 'session' })
        }
    }
    return [...out.values()]
}

/** YAML-ish frontmatter: `key: value` lines between `---` fences. */
function frontmatter(text) {
    const m = text.match(/^---\n([\s\S]*?)\n---/)
    const fields = {}
    if (m) for (const line of m[1].split('\n')) {
        const kv = line.match(/^([\w-]+):\s*(.*)$/)
        if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
    }
    return { fields, body: m ? text.slice(m[0].length) : text }
}

const firstLine = body => (body.split('\n').find(l => l.trim() && !l.startsWith('#')) || '').trim()

/** Skills (`<dir>/skills/<name>/SKILL.md`) and commands (`<dir>/commands/<name>.md`) in one `.claude` folder. */
function folderCommands(dir, source) {
    const out = []
    const read = file => {
        try {
            return fs.readFileSync(file, 'utf8')
        } catch {
            return null
        }
    }
    let names = []
    try {
        names = fs.readdirSync(path.join(dir, 'skills'))
    } catch {}
    for (const name of names) {
        const text = read(path.join(dir, 'skills', name, 'SKILL.md'))
        if (!text) continue
        const { fields, body } = frontmatter(text)
        if (fields['user-invocable'] === 'false') continue
        out.push({ name: fields.name || name, description: fields.description || firstLine(body), hint: fields['argument-hint'] || '', source })
    }
    try {
        names = fs.readdirSync(path.join(dir, 'commands'))
    } catch {
        names = []
    }
    for (const name of names) {
        if (!name.endsWith('.md')) continue
        const text = read(path.join(dir, 'commands', name))
        if (!text) continue
        const { fields, body } = frontmatter(text)
        out.push({ name: name.slice(0, -3), description: fields.description || firstLine(body), hint: fields['argument-hint'] || '', source })
    }
    return out
}

/**
 * Every slash command the session can run, by name: what the session lists wins for descriptions, the folders add
 * user-only skills and commands (and argument hints), built-ins fill in the rest.
 */
export function slashCommands(sessionId, workingFolder) {
    const byName = new Map()
    const add = (list, fillHint) => {
        for (const c of list) {
            const known = byName.get(c.name)
            if (!known) byName.set(c.name, { ...c, description: c.description.slice(0, 200) })
            else if (fillHint && c.hint && !known.hint) known.hint = c.hint
        }
    }
    add(sessionSkills(sessionId))
    add(folderCommands(path.join(HOME, '.claude'), 'user'), true)
    if (workingFolder && workingFolder !== HOME) add(folderCommands(path.join(workingFolder, '.claude'), 'project'), true)
    add(BUILTINS)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
