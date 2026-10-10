import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ROOT } from './helpers.js'

test('npm install builds the app', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.equal(scripts.prepare, 'npm run build')
    assert.match(scripts.build, /^vite build\b/)
})

test('the build writes the shell and the assets it links', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-build-'))
    try {
        execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'web/vite.config.ts', '--outDir', out, '--logLevel', 'error'], { cwd: ROOT })
        const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
        assert.match(html, /<div id="root"><\/div>/)
        const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(m => m[1])
        assert.ok(assets.some(a => a.endsWith('.js')), 'links a script')
        assert.ok(assets.some(a => a.endsWith('.css')), 'links a stylesheet')
        for (const a of assets) assert.ok(fs.existsSync(path.join(out, a)), `${a} exists`)
    } finally {
        fs.rmSync(out, { recursive: true, force: true })
    }
})
