#!/usr/bin/env node
// Link the /live-discussion-outline skill into a skills folder (default: ~/.claude/skills).
// The installed SKILL.md is a symlink to this checkout, so edits here show up immediately.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(process.argv[2] || path.join(os.homedir(), '.claude', 'skills'), 'live-discussion-outline')
const source = path.join(root, 'skill', 'SKILL.md')

fs.mkdirSync(target, { recursive: true })
const dest = path.join(target, 'SKILL.md')
fs.rmSync(dest, { force: true })
fs.symlinkSync(source, dest)
console.log(`linked ${dest} -> ${source}`)
