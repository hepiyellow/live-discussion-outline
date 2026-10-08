#!/usr/bin/env node
// Start the server in the background if it is not already answering, then print where things are.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'

const { dir, port, host } = loadConfig()
const url = `http://localhost:${port}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logFile = path.join(os.tmpdir(), 'live-discussion-outline.log')

const alive = async () => {
    try {
        return (await fetch(`http://127.0.0.1:${port}/health`)).ok
    } catch {
        return false
    }
}

if (!(await alive())) {
    const log = fs.openSync(logFile, 'a')
    spawn(process.execPath, [path.join(root, 'server.js')], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref()
    for (let i = 0; i < 20 && !(await alive()); i++) await new Promise(r => setTimeout(r, 250))
    if (!(await alive())) {
        console.error(`server failed to start; see ${logFile}`)
        process.exit(1)
    }
}
console.log(`dir=${dir}`)
console.log(`url=${url}`)
