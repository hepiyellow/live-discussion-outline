#!/usr/bin/env node
// The plugin's guard for outlines in server mode: before a file-writing tool runs, it refuses a write to an outline's
// file whose header says `Mode: server`. The server is that outline's only writer, and an agent changes it with the
// outline tools. A file anywhere else, and an outline in file mode, pass. Writes made through the shell are not seen.
// It never fails a tool call by breaking: on any error it says nothing, and the write goes ahead.
import fs from 'node:fs'
import path from 'node:path'
import { modeOf, outlinesDir } from './lib.js'

/** A path with its symlinks resolved, as far as it exists. */
const real = p => {
    try {
        return fs.realpathSync(p)
    } catch {
        return path.resolve(p)
    }
}

async function main() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    const event = JSON.parse(input || '{}')
    const target = event.tool_input?.file_path
    if (event.hook_event_name !== 'PreToolUse' || typeof target !== 'string' || !target) return
    const file = real(path.resolve(event.cwd || process.cwd(), target))
    // An outline is a markdown file directly in a project folder of the outlines folder.
    const parts = path.relative(real(outlinesDir()), file).split(path.sep)
    if (parts.length !== 2 || parts[0].startsWith('.') || !parts[1].endsWith('.md')) return
    if (modeOf(fs.readFileSync(file, 'utf8')) !== 'server') return
    console.log(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: `The outline ${parts[0]}/${parts[1].slice(0, -3)} is kept by the outline server (its file says "Mode: server"), which is its only writer: do not write the file. Change the outline with the outline tools (read, then one change call), as the outline skill describes.`,
            },
        }),
    )
}

main().catch(() => {}).finally(() => process.exit(0))
