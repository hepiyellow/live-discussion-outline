import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { loadConfig, settingsFile, writeSettings } from '../config.js'

// The settings file is at a fixed path under the home folder, so these tests run with HOME in a temporary folder.

describe('the settings file', () => {
    let home, realHome
    const write = settings => {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
        fs.writeFileSync(settingsFile(), typeof settings === 'string' ? settings : JSON.stringify(settings))
    }
    before(() => {
        realHome = process.env.HOME
        home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-config-')))
        process.env.HOME = home
    })
    after(() => {
        process.env.HOME = realHome
        fs.rmSync(home, { recursive: true, force: true })
    })
    beforeEach(() => fs.rmSync(path.join(home, '.config'), { recursive: true, force: true }))

    test('it is at a fixed path under the home folder', () => {
        assert.equal(settingsFile(), path.join(home, '.config', 'live-discussion-outline', 'config.json'))
    })

    test('without the file, the defaults', () => {
        const config = loadConfig()
        assert.equal(config.dir, path.join(home, 'live-discussion-outlines'))
        assert.equal(config.port, 4577)
        assert.equal(config.appPort, 0)
        assert.equal(config.linkBase, 'http://localhost:4577')
        assert.equal(config.resumeTemplate, '')
    })

    test('without `dir`, the default outlines folder beside the other keys', () => {
        write({ port: 5000, resumeTemplate: 'claude --resume {session}' })
        const config = loadConfig()
        assert.equal(config.dir, path.join(home, 'live-discussion-outlines'))
        assert.equal(config.port, 5000)
        assert.equal(config.linkBase, 'http://localhost:5000')
        assert.equal(config.resumeTemplate, 'claude --resume {session}')
    })

    test('`~` in `dir` is the home folder', () => {
        write({ dir: '~/.claude/outlines' })
        assert.equal(loadConfig().dir, path.join(home, '.claude', 'outlines'))
        write({ dir: '~' })
        assert.equal(loadConfig().dir, home)
        write({ dir: '/srv/~outlines' })
        assert.equal(loadConfig().dir, '/srv/~outlines')
    })

    test('the app port and the link base are read', () => {
        write({ appPort: 51234, linkBase: 'outline://open' })
        const config = loadConfig()
        assert.equal(config.appPort, 51234)
        assert.equal(config.linkBase, 'outline://open')
    })

    test('no environment variable moves the folder, the port, the resume template or the file', () => {
        write({ dir: '~/mine', port: 5001, resumeTemplate: 'from the file' })
        const env = { OUTLINE_DIR: '/elsewhere', OUTLINE_PORT: '9', OUTLINE_RESUME_TEMPLATE: 'from the shell', OUTLINE_CONFIG: path.join(home, 'other.json') }
        fs.writeFileSync(env.OUTLINE_CONFIG, JSON.stringify({ dir: '/other' }))
        Object.assign(process.env, env)
        try {
            const config = loadConfig()
            assert.equal(config.dir, path.join(home, 'mine'))
            assert.equal(config.port, 5001)
            assert.equal(config.resumeTemplate, 'from the file')
        } finally {
            for (const name of Object.keys(env)) delete process.env[name]
        }
    })

    test('a file that is not JSON is ignored', t => {
        t.mock.method(console, 'error', () => {})
        write('{ "dir": ')
        assert.equal(loadConfig().dir, path.join(home, 'live-discussion-outlines'))
        assert.equal(console.error.mock.callCount(), 1)
    })

    test('writing creates the file and its folder', () => {
        writeSettings({ dir: '~/outlines' })
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), { dir: '~/outlines' })
        assert.equal(loadConfig().dir, path.join(home, 'outlines'))
    })

    test('writing keeps the keys it is not given, unknown ones too', () => {
        write({ dir: '~/outlines', resumeTemplate: 'claude --resume {session}', somethingNew: { a: 1 } })
        const written = writeSettings({ appPort: 51234, linkBase: 'outline://open' })
        const expected = { dir: '~/outlines', resumeTemplate: 'claude --resume {session}', somethingNew: { a: 1 }, appPort: 51234, linkBase: 'outline://open' }
        assert.deepEqual(written, expected)
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), expected)
        assert.deepEqual(fs.readdirSync(path.dirname(settingsFile())), ['config.json'])
    })
})
