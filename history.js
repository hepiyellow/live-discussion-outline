import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { outlinePayload } from './outline.js'

/** The folder of the outlines folder where node history is kept: one JSON Lines file per outline. */
export const HISTORY_DIR = '.history'

const hash = text => crypto.createHash('sha1').update(text).digest('hex')

/** Every node of an outline by its number, with its children (the whole subtree) as the node JSON the page reads. */
function nodesByNum(nodes, out = new Map()) {
    for (const n of nodes) {
        out.set(n.num, n)
        nodesByNum(n.children, out)
    }
    return out
}

const readLines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])

/**
 * The history of each node of the outlines under `root`. Each time an outline file changes, every node whose subtree
 * reads differently from its last recorded entry gets a new entry: its time and its whole subtree, children included,
 * so that a parent's history also shows changes under it.
 */
export function createHistory(root) {
    // The hash of each node's last entry, per outline, loaded from its file the first time the outline is recorded.
    const lastHashes = new Map()
    const fileOf = (project, file) => path.join(root, HISTORY_DIR, project, `${file}.jsonl`)

    function hashesOf(project, file) {
        const key = `${project}/${file}`
        if (!lastHashes.has(key)) {
            const hashes = new Map()
            for (const line of readLines(fileOf(project, file))) {
                const entry = JSON.parse(line)
                hashes.set(entry.num, entry.hash)
            }
            lastHashes.set(key, hashes)
        }
        return lastHashes.get(key)
    }

    return {
        /** Records the nodes of an outline's text that changed since their last entry. Returns how many entries it wrote. */
        record(project, file, text, at = Date.now()) {
            const hashes = hashesOf(project, file)
            const lines = []
            for (const [num, node] of nodesByNum(outlinePayload(text).nodes)) {
                const json = JSON.stringify(node)
                const h = hash(json)
                if (hashes.get(num) === h) continue
                hashes.set(num, h)
                lines.push(JSON.stringify({ at, num, hash: h, node }))
            }
            if (!lines.length) return 0
            fs.mkdirSync(path.dirname(fileOf(project, file)), { recursive: true })
            fs.appendFileSync(fileOf(project, file), `${lines.join('\n')}\n`)
            return lines.length
        },

        /** The entries of one node, oldest first: `{ at, node }`, where `node` is its subtree at that time. */
        read(project, file, num) {
            return readLines(fileOf(project, file))
                .map(line => JSON.parse(line))
                .filter(entry => entry.num === num)
                .map(({ at, node }) => ({ at, node }))
        },
    }
}
