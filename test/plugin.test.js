import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ROOT, inServerMode, startServer } from './helpers.js'

// What the plugin gives file mode: the skill's start script, and the guard that keeps an agent's file tools off an
// outline the server keeps. (The MCP tools and the other hooks are in mcp.test.js.)

const SCRIPTS = path.join(ROOT, 'plugin', 'scripts')
const SESSION = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

/**
 * Runs a script of the plugin as an agent's session would, and returns what it printed and how it ended. The session's
 * own variables start empty, so a test run from inside an agent's session does not read that session's.
 */
function run(server, script, { env = {}, input = '' } = {}) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, HOME: server.home, TMUX: '', OUTLINE_PROJECT: '', OUTLINE_PORT: '', CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', d => (out += d))
        child.stderr.on('data', d => (err += d))
        child.on('exit', code => resolve({ out, err, code }))
        child.stdin.end(input)
    })
}

describe('the plugin, for file mode', () => {
    let server
    before(async () => (server = await startServer()))
    after(() => server?.stop())

    test('the skill is the plugin’s, and names the start script that is there', () => {
        const skill = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'outline-file', 'SKILL.md'), 'utf8')
        assert.match(skill, /^---\nname: outline-file\n/)
        assert.match(skill, /Run `node <plugin>\/scripts\/outline-ensure\.js`/)
        assert.match(skill, /do not use the plugin's outline tools/)
        assert.equal(fs.existsSync(path.join(SCRIPTS, 'outline-ensure.js')), true)
    })

    test('the start script finds the running server and prints where things are, in six lines', async () => {
        const { out, code } = await run(server, 'outline-ensure.js', { env: { CLAUDE_CODE_SESSION_ID: SESSION, OUTLINE_PROJECT: 'my-workspace' } })
        assert.equal(code, 0)
        assert.deepEqual(out.split('\n'), [`dir=${server.dir}`, `url=http://localhost:${server.settingsPort}`, 'resume=', 'terminal=', `session=${SESSION}`, 'project=my-workspace', ''])
    })

    test('the start script prints the settings file’s resume template and link base', async () => {
        const settings = path.join(server.home, '.config', 'outline-only', 'config.json')
        const before = fs.readFileSync(settings, 'utf8')
        fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(before), resumeTemplate: 'claude --resume {session}', linkBase: 'outline-only://open' }))
        try {
            const { out } = await run(server, 'outline-ensure.js')
            assert.deepEqual(out.split('\n').slice(1, 6), ['url=outline-only://open', 'resume=claude --resume {session}', 'terminal=', 'session=', 'project='])
        } finally {
            fs.writeFileSync(settings, before)
        }
    })

    /** What the guard answers to a file tool about to write `file`: its decision, or undefined when it has none. */
    const guard = async (tool, file) => {
        const event = { hook_event_name: 'PreToolUse', session_id: SESSION, cwd: server.home, tool_name: tool, tool_input: { file_path: file, content: 'x' } }
        const { out, code } = await run(server, 'outline-guard.js', { input: JSON.stringify(event) })
        assert.equal(code, 0)
        return out ? JSON.parse(out).hookSpecificOutput : undefined
    }

    test('the guard refuses a write to the file of an outline the server keeps, and names the outline tools', async () => {
        const kept = path.join(server.dir, 'demo', 'kept.md')
        fs.writeFileSync(kept, inServerMode(fs.readFileSync(path.join(server.dir, 'demo', 'sample.md'), 'utf8')))
        try {
            for (const tool of ['Write', 'Edit']) {
                const decision = await guard(tool, kept)
                assert.equal(decision.hookEventName, 'PreToolUse', tool)
                assert.equal(decision.permissionDecision, 'deny', tool)
                assert.match(decision.permissionDecisionReason, /The outline demo\/kept is kept by the outline server/, tool)
                assert.match(decision.permissionDecisionReason, /outline tools/, tool)
            }
            // A path given relative to the session's folder is the same file.
            assert.equal((await guard('Edit', path.relative(server.home, kept))).permissionDecision, 'deny')
        } finally {
            fs.rmSync(kept)
        }
    })

    test('the guard lets through an outline in file mode, a new outline, and a file anywhere else', async () => {
        assert.equal(await guard('Edit', path.join(server.dir, 'demo', 'sample.md')), undefined)
        assert.equal(await guard('Write', path.join(server.dir, 'demo', 'not-written-yet.md')), undefined)
        const elsewhere = path.join(server.home, 'notes.md')
        fs.writeFileSync(elsewhere, 'Title: Notes\nMode: server\n\n# 1. Not an outline\n')
        assert.equal(await guard('Write', elsewhere), undefined)
        // Not an outline either: a file deeper in a project folder, and one in a folder the server keeps for itself.
        fs.mkdirSync(path.join(server.dir, 'demo', 'sub'), { recursive: true })
        fs.writeFileSync(path.join(server.dir, 'demo', 'sub', 'deep.md'), 'Mode: server\n')
        assert.equal(await guard('Write', path.join(server.dir, 'demo', 'sub', 'deep.md')), undefined)
        fs.rmSync(path.join(server.dir, 'demo', 'sub'), { recursive: true })
    })

    test('the guard has nothing to say about a tool that names no file', async () => {
        const { out, code } = await run(server, 'outline-guard.js', { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }) })
        assert.deepEqual({ out, code }, { out: '', code: 0 })
        assert.deepEqual(await run(server, 'outline-guard.js', { input: 'not json' }), { out: '', err: '', code: 0 })
    })

    test('the plugin’s hooks run the guard before the file-writing tools', () => {
        const { hooks } = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'hooks', 'hooks.json'), 'utf8'))
        assert.equal(hooks.PreToolUse.length, 1)
        assert.equal(hooks.PreToolUse[0].matcher, 'Write|Edit|MultiEdit')
        assert.match(hooks.PreToolUse[0].hooks[0].command, /outline-guard\.js/)
    })
})
