#!/usr/bin/env node
// Link the /outline-only skill into a skills folder (default: ~/.claude/skills).
// The installed SKILL.md is a symlink to this checkout, so edits here show up immediately.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skills = process.argv[2] || path.join(os.homedir(), '.claude', 'skills')
const target = path.join(skills, 'outline-only')
const source = path.join(root, 'skill', 'SKILL.md')

fs.mkdirSync(target, { recursive: true })
const dest = path.join(target, 'SKILL.md')
fs.rmSync(dest, { force: true })
fs.symlinkSync(source, dest)
console.log(`linked ${dest} -> ${source}`)

// The skill's name before "outline-only": its link would show the skill a second time under the old name.
const old = path.join(skills, 'live-discussion-outline')
const oldLink = path.join(old, 'SKILL.md')
if (fs.lstatSync(oldLink, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(oldLink) === source) {
    fs.rmSync(oldLink)
    if (fs.readdirSync(old).length === 0) fs.rmdirSync(old)
    console.log(`removed ${oldLink}`)
}
