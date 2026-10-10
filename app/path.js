import { spawn } from 'node:child_process'

// An app opened from the Finder gets launchd's short PATH, without Homebrew's folder or ~/.local/bin, so the server
// would not find tmux or claude. The login shell knows the PATH the user's terminals have.

const MARK = '__LDO_PATH__'
const USUAL = ['/opt/homebrew/bin', '/usr/local/bin']

/** The PATH a login shell printed between our marks (a shell's startup files print around it), or empty. */
export function parseShellPath(output) {
    const found = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(output)?.[1].trim() ?? ''
    return found.split(':').some(folder => folder.startsWith('/')) ? found : ''
}

/** The PATH used when the login shell does not answer: the current one plus where Homebrew puts tmux. */
export const fallbackPath = (current = '') => [...new Set([...current.split(':'), ...USUAL])].filter(Boolean).join(':')

/**
 * The PATH of the user's login shell (`$SHELL -ilc`, as start.js asks it for `claude`), or the fallback when the shell
 * fails or takes longer than `timeout` ms. It never rejects.
 */
export function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', env = process.env, timeout = 5000 } = {}) {
    const fallback = fallbackPath(env.PATH)
    return new Promise(resolve => {
        let output = ''
        let child
        const done = found => {
            clearTimeout(timer)
            resolve(found || fallback)
        }
        const timer = setTimeout(() => {
            // The shell's whole process group: a startup file may have started something that outlives the shell.
            try {
                process.kill(-child.pid, 'SIGKILL')
            } catch {}
            done('')
        }, timeout)
        try {
            child = spawn(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { env, stdio: ['ignore', 'pipe', 'ignore'], detached: true })
        } catch {
            return done('')
        }
        child.stdout.on('data', data => (output += data))
        child.on('error', () => done(''))
        child.on('close', () => done(parseShellPath(output)))
    })
}
