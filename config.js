import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_CONFIG_FILE = path.join(os.homedir(), '.config', 'live-discussion-outline', 'config.json')

const expandHome = p => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)

/** Precedence: environment variables, then the config file, then defaults. */
export function loadConfig() {
    const configFile = process.env.OUTLINE_CONFIG || DEFAULT_CONFIG_FILE
    let file = {}
    try {
        file = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`ignoring unreadable config ${configFile}: ${e.message}`)
    }
    const dir = path.resolve(expandHome(process.env.OUTLINE_DIR || file.dir || '~/live-discussion-outlines'))
    const port = Number(process.env.OUTLINE_PORT || file.port || 4577)
    const host = process.env.OUTLINE_HOST || file.host || '127.0.0.1'
    const resumeTemplate = process.env.OUTLINE_RESUME_TEMPLATE || file.resumeTemplate || ''
    // Folders searched (with their direct subfolders) for editor workspace files, for "New session". Empty: look
    // beside the folders recent Claude Code sessions ran in.
    const workspaceDirs = process.env.OUTLINE_WORKSPACE_DIRS ? process.env.OUTLINE_WORKSPACE_DIRS.split(path.delimiter) : file.workspaceDirs || []
    const claudeCommand = process.env.OUTLINE_CLAUDE || file.claudeCommand || ''
    return { dir, port, host, resumeTemplate, workspaceDirs, claudeCommand, configFile }
}
