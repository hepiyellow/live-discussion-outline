#!/usr/bin/env node
// Installs the outline-only plugin (its two skills, its MCP tools and its hooks) into Claude Code from this checkout, and
// writes the checkout's path into the settings file, so the installed copy of the plugin can start this server.
// `--print` only prints the commands. Other agents: see README.md.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSettings } from '../config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commands = [
    ['claude', 'plugin', 'marketplace', 'add', root],
    ['claude', 'plugin', 'install', 'outline-only@outline-only'],
]

if (process.argv.includes('--print')) {
    for (const c of commands) console.log(c.join(' '))
    process.exit(0)
}

writeSettings({ checkout: root })
for (const [command, ...args] of commands) {
    console.log(`> ${command} ${args.join(' ')}`)
    try {
        execFileSync(command, args, { stdio: 'inherit' })
    } catch (e) {
        console.error(e.code === 'ENOENT' ? 'Claude Code is not installed (no `claude` command). For one session, run: claude --plugin-dir ' + path.join(root, 'plugin') : `failed: ${e.message}`)
        process.exit(1)
    }
}

// The skill before the plugin was linked into the skills folder. File mode's skill now comes with the plugin, as
// /outline-only:outline-file, so that link would show it a second time, and from a file this checkout no longer has.
const link = path.join(os.homedir(), '.claude', 'skills', 'outline-only', 'SKILL.md')
if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(link).startsWith(root)) {
    fs.rmSync(link)
    if (fs.readdirSync(path.dirname(link)).length === 0) fs.rmdirSync(path.dirname(link))
    console.log(`removed ${link}`)
}
console.log('Installed. In a conversation, type /outline-only:outline (the server keeps the outline) or /outline-only:outline-file (the agent writes its file), optionally with a topic.')
