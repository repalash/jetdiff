#!/usr/bin/env node
// npm run build: copies the files the site serves into dist/ (the Worker's static assets): the app's own files, the
// libraries from node_modules into dist/vendor/ (as they are, no bundling), and sw.js with its release (site.mjs)
import fs from 'node:fs'
import path from 'node:path'
import {checkVendor, FILES, ROOT as root, serviceWorker, vendor} from './site.mjs'

// Cloudflare's limits for a Worker's static assets
const MAX_FILES = 20000
const MAX_FILE_SIZE = 25 * 1024 * 1024

const stale = await checkVendor()
if (stale) {
    console.error(stale)
    process.exit(1)
}
const out = path.join(root, 'dist')
fs.rmSync(out, {recursive: true, force: true})
for (const f of FILES) fs.cpSync(path.join(root, f), path.join(out, f), {recursive: true})
fs.writeFileSync(path.join(out, 'sw.js'), serviceWorker())
for (const [to, from] of vendor().files) {
    fs.mkdirSync(path.dirname(path.join(out, to)), {recursive: true})
    fs.copyFileSync(from, path.join(out, to))
}

let count = 0, size = 0
const tooBig = []
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const f = path.join(dir, e.name)
        if (e.isDirectory()) { walk(f); continue }
        const s = fs.statSync(f).size
        count++
        size += s
        if (s > MAX_FILE_SIZE) tooBig.push(path.relative(out, f))
    }
}
walk(out)
console.log(`dist/: ${count} files, ${(size / 1024 / 1024).toFixed(1)} MiB (${vendor().files.size} of them in vendor/)`)
if (count > MAX_FILES || tooBig.length) {
    console.error(count > MAX_FILES ? `More than ${MAX_FILES} files` : `Over 25 MiB: ${tooBig.join(', ')}`)
    process.exit(1)
}
