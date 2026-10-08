#!/usr/bin/env node
// Install the /live-discussion-outline skill into a skills folder (default: ~/.claude/skills), pointing at this checkout.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(process.argv[2] || path.join(os.homedir(), '.claude', 'skills'), 'live-discussion-outline')
const template = fs.readFileSync(path.join(root, 'skill', 'SKILL.md'), 'utf8')

fs.mkdirSync(target, { recursive: true })
fs.writeFileSync(path.join(target, 'SKILL.md'), template.replaceAll('__REPO_DIR__', root))
console.log(`installed ${path.join(target, 'SKILL.md')}`)
