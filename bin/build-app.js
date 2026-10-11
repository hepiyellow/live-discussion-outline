#!/usr/bin/env node
// Builds the Outline app ("Outline Only.app") from this checkout, for this Mac only: an ad-hoc signature, no
// notarization, no updater. Then it replaces the copy in /Applications and links the skill.
// `--build-only` stops after building and signing, leaving the app in dist/.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { SCHEME } from '../app/links.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist')
const buildOnly = process.argv.includes('--build-only')
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options })

if (process.platform !== 'darwin') {
    console.error('The Outline app is built for macOS only; use `npm start` elsewhere.')
    process.exit(1)
}

// The page first: the app serves web/dist, as the server does from the repo.
run('npm', ['run', 'build'])

const { packager } = createRequire(import.meta.url)('@electron/packager')
const { productName } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const [built] = await packager({
    dir: root,
    out,
    overwrite: true,
    platform: 'darwin',
    arch: process.arch,
    icon: path.join(root, 'app', 'icon', 'icon.icns'),
    appBundleId: 'io.github.hepiyellow.outline-only',
    appCategoryType: 'public.app-category.productivity',
    // The app's links (app/links.js): the Info.plist says which scheme the app opens.
    protocols: [{ name: productName, schemes: [SCHEME] }],
    // A second name Spotlight finds the app by: its initials.
    extendInfo: { CFBundleAlternateNames: ['OO'] },
    // No asar archive, so node-pty's binary and spawn-helper, web/dist and the server's files load as from the repo.
    asar: false,
    // Dev dependencies are left out (Vite, React and the rest are already built into web/dist).
    prune: true,
    // What the app does not run: tests, docs, the page's sources, and the caches tools keep in node_modules (Vite's).
    // The plugin goes in: sessions the app starts load it from the bundle (start.js).
    ignore: [/^\/(test|docs|spike|examples|dist|bin)($|\/)/, /^\/\.(github|claude|vscode)($|\/)/, /^\/web\/(?!dist($|\/))/, /^\/node_modules\/\./],
    quiet: true,
})
const app = path.join(built, `${productName}.app`)
const resources = path.join(app, 'Contents', 'Resources', 'app')

// npm unpacks node-pty's spawn-helper without its execute bit. terminal.js sets it on first use, which in the built
// app would change a file inside the signed bundle: set it now.
// Of node-pty's prebuilt binaries only this Mac's is kept; the Windows ones are most of the package.
const prebuilds = path.join(resources, 'node_modules', 'node-pty', 'prebuilds')
const mine = `${process.platform}-${process.arch}`
for (const platform of fs.readdirSync(prebuilds)) if (platform !== mine) fs.rmSync(path.join(prebuilds, platform), { recursive: true })
fs.chmodSync(path.join(prebuilds, mine, 'spawn-helper'), 0o755)

run('codesign', ['--force', '--deep', '--sign', '-', app])
run('codesign', ['--verify', '--deep', '--strict', app])
console.log(`built ${path.relative(root, app)}`)

if (!buildOnly) {
    const installed = path.join('/Applications', path.basename(app))
    if (isRunning(installed)) {
        console.error(`${productName} is running. Quit it, then run \`npm run app\` again (the app just built is in dist/).`)
        process.exit(1)
    }
    fs.rmSync(installed, { recursive: true, force: true })
    // ditto keeps the bundle's symlinks, modes and signature as they are.
    run('ditto', [app, installed])
    // One copy of the app on this Mac: a second one would also claim the app's links.
    fs.rmSync(out, { recursive: true, force: true })
    console.log(`installed ${installed}`)
    run(process.execPath, [path.join(root, 'bin', 'install-plugin.js')])
}

/** Whether the app at `bundle` has a process running. */
function isRunning(bundle) {
    try {
        return execFileSync('pgrep', ['-f', `${bundle}/Contents/MacOS/`], { encoding: 'utf8' }).trim() !== ''
    } catch {
        return false
    }
}
