#!/usr/bin/env node
// npm start: serves the app from the repository root on PORT (default 3000)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = +(process.env.PORT || 3000)
const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip',
}

http.createServer((req, res) => {
    let file
    try {
        file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    } catch { return res.writeHead(400).end() } // a malformed escape
    if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end()
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) return res.writeHead(404).end('Not found')
    res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'})
    fs.createReadStream(file).pipe(res)
}).listen(port, () => console.log(`http://localhost:${port}/`))
