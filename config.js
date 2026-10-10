import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The settings file, at a fixed path: the skill, the server and the Outline app all read it, and no environment
 * variable moves it, since an app opened from the Finder does not see the shell profile's variables.
 */
export const settingsFile = () => path.join(os.homedir(), '.config', 'live-discussion-outline', 'config.json')

const expandHome = p => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)

/** The settings file's keys as written, or none when it is missing or unreadable. */
function readSettings() {
    const file = settingsFile()
    try {
        const settings = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings
        console.error(`ignoring settings file ${file}: not a JSON object`)
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`ignoring unreadable settings file ${file}: ${e.message}`)
    }
    return {}
}

/**
 * The settings file, then defaults. The outlines folder, the ports, the resume template and the link base come from
 * the file alone, so the skill (which reads the file) and the server never disagree; the settings only the server
 * uses can also be set by environment variables.
 */
export function loadConfig() {
    const file = readSettings()
    const dir = path.resolve(expandHome(file.dir || '~/live-discussion-outlines'))
    const port = Number(file.port || 4577)
    // The port the Outline app picked and keeps; `port` is what `npm start` listens on.
    const appPort = Number(file.appPort || 0)
    // The start of every link the skill prints, followed by /<project>/<file>.
    const linkBase = file.linkBase || `http://localhost:${port}`
    const host = process.env.OUTLINE_HOST || file.host || '127.0.0.1'
    const resumeTemplate = file.resumeTemplate || ''
    // Folders searched (with their direct subfolders) for editor workspace files, for "New session". Empty: look
    // beside the folders recent Claude Code sessions ran in.
    const workspaceDirs = process.env.OUTLINE_WORKSPACE_DIRS ? process.env.OUTLINE_WORKSPACE_DIRS.split(path.delimiter) : file.workspaceDirs || []
    const claudeCommand = process.env.OUTLINE_CLAUDE || file.claudeCommand || ''
    return { dir, port, appPort, linkBase, host, resumeTemplate, workspaceDirs, claudeCommand }
}

/**
 * Merges `patch` into the settings file, creating it and its folder when missing, and keeps every key the caller does
 * not own. Returns the settings as written.
 */
export function writeSettings(patch) {
    const file = settingsFile()
    const settings = { ...readSettings(), ...patch }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Written beside the file and renamed over it, so a reader never sees half a file.
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 4) + '\n')
    fs.renameSync(tmp, file)
    return settings
}
