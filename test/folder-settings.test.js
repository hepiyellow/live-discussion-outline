import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { settingsFile, writeSettings } from '../config.js'
import { applyMove, isFirstRun, movePlan, moveQuestion, tildePath } from '../app/settings.js'
import { superviseServer } from '../app/supervisor.js'
import { FIXTURES, SESSION } from './helpers.js'

// The Outline app's folder setting: the first run, and moving the outlines when the folder changes.

describe('moving the outlines folder', () => {
    let scratch, from, to
    const write = (file, text = 'x') => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, text)
    }
    /** Every file under `dir`, relative to it, sorted. */
    const files = (dir, rel = '') =>
        fs
            .readdirSync(path.join(dir, rel), { withFileTypes: true })
            .flatMap(e => (e.isDirectory() ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]))
            .sort()
    /** The fixture session runs; nothing else does. */
    const isRunning = ({ session }) => session === SESSION

    beforeEach(() => {
        scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-move-')))
        from = path.join(scratch, 'old')
        to = path.join(scratch, 'new')
        // The fixture outlines (demo/sample.md links a session), another project, and what the server keeps beside them.
        fs.cpSync(path.join(FIXTURES, 'outlines'), from, { recursive: true })
        write(path.join(from, 'Other-Project', 'plan.md'), 'Title: A plan\n\n# 1. A\n')
        write(path.join(from, 'Other-Project', 'notes.txt'))
        write(path.join(from, '.state', 'demo', 'sample.json'), '{}')
        write(path.join(from, '.trash', 'demo', 'gone.md'), 'Title: Gone\n')
        write(path.join(from, '.DS_Store'))
    })
    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }))

    test('everything in the folder moves: outlines, viewer state and trash', () => {
        const plan = movePlan({ from, to, isRunning })
        assert.equal(plan.blocked, undefined)
        assert.deepEqual([...plan.moves].sort(), ['.state/demo/sample.json', '.trash/demo/gone.md', 'Other-Project/notes.txt', 'Other-Project/plan.md', 'demo/sample-edited.md', 'demo/sample.md'])
        assert.deepEqual(plan.skipped, [])
        // The outlines are the .md files of the project folders: not the trashed one, not the notes.
        assert.equal(plan.outlines, 3)
    })

    test('the outlines whose session still runs are named', () => {
        const plan = movePlan({ from, to, isRunning })
        // Both fixture outlines link the fixture session; the other project's outline links none.
        assert.deepEqual(plan.running.map(o => `${o.project}/${o.file}`).sort(), ['demo/sample', 'demo/sample-edited'])
        assert.ok(plan.running.some(o => o.project === 'demo' && o.file === 'sample' && o.title === 'Caching for the search service'))
        assert.deepEqual(movePlan({ from, to }).running, [])
    })

    test('an outline is running when its tmux session is, too', () => {
        const plan = movePlan({ from, to, isRunning: ({ terminal }) => terminal === 'ldo-sample' })
        assert.ok(plan.running.some(o => o.file === 'sample'))
        assert.ok(!plan.running.some(o => o.project === 'Other-Project'))
    })

    test('a file whose place in the new folder is taken stays', () => {
        write(path.join(to, 'demo', 'sample.md'), 'Title: Already here\n')
        write(path.join(to, '.state', 'demo', 'sample.json'), '{"mine":1}')
        const plan = movePlan({ from, to, isRunning })
        assert.deepEqual([...plan.skipped].sort(), ['.state/demo/sample.json', 'demo/sample.md'])
        assert.equal(plan.outlines, 2)
        assert.ok(!plan.moves.includes('demo/sample.md'))
        // It still runs in the old folder, so it is still named.
        assert.ok(plan.running.some(o => o.file === 'sample'))
    })

    test('the same folder, or one inside the old folder, moves nothing', () => {
        assert.equal(movePlan({ from, to: from }).blocked, 'same')
        assert.equal(movePlan({ from, to: `${from}/` }).blocked, 'same')
        const inside = movePlan({ from, to: path.join(from, 'demo', 'deeper') })
        assert.equal(inside.blocked, 'inside')
        assert.deepEqual(inside.moves, [])
        // A folder that only starts with the same name is another folder.
        assert.equal(movePlan({ from, to: `${from}-2` }).blocked, undefined)
    })

    test('a folder that is not there has nothing to move', () => {
        const plan = movePlan({ from: path.join(scratch, 'nowhere'), to })
        assert.deepEqual(plan.moves, [])
        assert.equal(plan.outlines, 0)
    })

    test('carrying out the plan moves the files and removes the folders it emptied', () => {
        const before = fs.readFileSync(path.join(from, 'demo', 'sample.md'), 'utf8')
        const result = applyMove(movePlan({ from, to, isRunning }))
        assert.deepEqual(result, { moved: 6, failed: [] })
        assert.deepEqual(files(to), ['.state/demo/sample.json', '.trash/demo/gone.md', 'Other-Project/notes.txt', 'Other-Project/plan.md', 'demo/sample-edited.md', 'demo/sample.md'])
        assert.equal(fs.readFileSync(path.join(to, 'demo', 'sample.md'), 'utf8'), before)
        // The old folder itself stays, with Finder's file and nothing else.
        assert.deepEqual(fs.readdirSync(from), ['.DS_Store'])
    })

    test('a skipped file and its folder stay in the old folder', () => {
        write(path.join(to, 'demo', 'sample.md'), 'Title: Already here\n')
        const result = applyMove(movePlan({ from, to, isRunning }))
        assert.equal(result.moved, 5)
        assert.deepEqual(files(from), ['.DS_Store', 'demo/sample.md'])
        assert.equal(fs.readFileSync(path.join(to, 'demo', 'sample.md'), 'utf8'), 'Title: Already here\n')
    })

    test('a file that cannot be moved is reported and left', () => {
        const plan = movePlan({ from, to, isRunning })
        // Something took the place of a project folder in the new folder after the plan was made.
        write(path.join(to, 'Other-Project'))
        const result = applyMove(plan)
        assert.equal(result.moved, 4)
        assert.deepEqual(result.failed.map(f => f.file).sort(), ['Other-Project/notes.txt', 'Other-Project/plan.md'])
        assert.ok(fs.existsSync(path.join(from, 'Other-Project', 'plan.md')))
    })

    test('the question says how many outlines move, and names the running ones', () => {
        write(path.join(to, 'Other-Project', 'notes.txt'))
        const { message, detail } = moveQuestion(movePlan({ from, to, isRunning }))
        assert.equal(message, 'Move 3 outlines to the new folder?')
        assert.match(detail, /still running and will keep writing/)
        assert.match(detail, /• Caching for the search service \(demo\)/)
        assert.match(detail, /1 file stays in the old folder/)
        const one = moveQuestion({ from, to, moves: ['a/b.md'], skipped: [], outlines: 1, running: [] })
        assert.equal(one.message, 'Move 1 outline to the new folder?')
        assert.doesNotMatch(one.detail, /running|stays/)
        assert.match(moveQuestion({ from, to, moves: ['.trash/a/b.md'], skipped: [], outlines: 0, running: [] }).message, /^Move the trash/)
    })
})

describe('the folder in the settings file', () => {
    let home, realHome
    beforeEach(() => {
        realHome = process.env.HOME
        home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-first-')))
        process.env.HOME = home
    })
    afterEach(() => {
        process.env.HOME = realHome
        fs.rmSync(home, { recursive: true, force: true })
    })

    test('it is the first run until something writes the settings file', () => {
        assert.equal(isFirstRun(), true)
        writeSettings({ dir: '~/outlines' })
        assert.equal(isFirstRun(), false)
        assert.ok(fs.existsSync(settingsFile()))
    })

    test('a folder under the home folder is written with ~', () => {
        assert.equal(tildePath(path.join(home, 'Documents', 'outlines')), '~/Documents/outlines')
        assert.equal(tildePath(home), '~')
        assert.equal(tildePath('/Volumes/Work/outlines'), '/Volumes/Work/outlines')
        assert.equal(tildePath(`${home}-other/outlines`), `${home}-other/outlines`)
        assert.equal(tildePath('~/already'), '~/already')
    })
})

describe('restarting the app’s server for a new folder', () => {
    test('stopping waits for the server to be gone, and it then starts on the same port', async () => {
        const started = []
        const fork = args => {
            const child = Object.assign(new EventEmitter(), { args, kill: () => setTimeout(() => child.emit('exit', 0), 20) })
            started.push(child)
            return child
        }
        let gaveUp = 0
        const server = superviseServer({ fork, port: 0, onListening: () => {}, onGaveUp: () => gaveUp++ })
        started[0].emit('message', { port: 51234 })
        let gone = false
        started[0].once('exit', () => (gone = true))
        await server.stop()
        assert.equal(gone, true)
        assert.equal(started.length, 1)
        server.start()
        assert.deepEqual(started[1].args, ['--port', '51234'])
        // Stopped on purpose twice in a row: that is not a server that keeps dying.
        await server.stop()
        server.start()
        assert.equal(started.length, 3)
        assert.equal(gaveUp, 0)
        // Stopping a server that is already gone does not wait.
        await server.stop()
        await server.stop()
    })
})
