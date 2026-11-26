#!/usr/bin/env node
// npm start: serves the app from the repository root on PORT (default 3000), as the Worker serves the build: the
// libraries at vendor/ (from node_modules) and sw.js with its release
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {checkVendor, ROOT as root, serviceWorker, vendor} from './site.mjs'

const port = +(process.env.PORT || 3000)
const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.zip': 'application/zip',
    '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

const stale = await checkVendor()
if (stale) {
    console.error(stale)
    process.exit(1)
}
const libs = vendor().files

http.createServer((req, res) => {
    let pathname
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch { return res.writeHead(400).end() } // a malformed escape
    const send = (status, type, {file, text}) => {
        res.writeHead(status, {'content-type': type, 'cache-control': 'no-cache'})
        if (file) fs.createReadStream(file).pipe(res)
        else res.end(text)
    }
    if (pathname === '/sw.js') return send(200, types['.js'], {text: serviceWorker()})
    // only the libraries' files the build copies
    let file = pathname.startsWith('/vendor/') ? libs.get(pathname.slice(1)) : path.join(root, pathname)
    if (file && !pathname.startsWith('/vendor/')) {
        if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end()
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    }
    // as the static host does: a missing path answers with 404.html
    if (!file || !fs.existsSync(file)) return send(404, types['.html'], {file: path.join(root, '404.html')})
    send(200, types[path.extname(file)] || 'application/octet-stream', {file})
}).listen(port, function () { console.log(`http://localhost:${this.address().port}/`) })
