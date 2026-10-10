#!/usr/bin/env node
// Rebuilds the Outline app's icon from app/icon/icon.svg: icon.png (the Dock icon of `npm run app:dev`) and icon.icns
// (the built app's). Mac only: it uses sips and iconutil, which come with macOS.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icon')
const svg = path.join(dir, 'icon.svg')
const png = path.join(dir, 'icon.png')
const run = (file, args) => execFileSync(file, args, { stdio: ['ignore', 'ignore', 'inherit'] })

run('sips', ['-s', 'format', 'png', svg, '--out', png])

// The sizes an .icns holds, each also at twice the pixels.
const iconset = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ldo-icon-')), 'icon.iconset')
fs.mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2]) {
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
        run('sips', ['-z', String(size * scale), String(size * scale), png, '--out', path.join(iconset, name)])
    }
run('iconutil', ['-c', 'icns', iconset, '-o', path.join(dir, 'icon.icns')])
fs.rmSync(path.dirname(iconset), { recursive: true, force: true })
console.log(`wrote ${path.relative(process.cwd(), png)} and icon.icns`)
