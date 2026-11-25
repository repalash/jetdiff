#!/usr/bin/env node
// npm run build: copies the files the site serves into dist/ (the Worker's static assets)
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist')
const FILES = [
    'index.html', '404.html', 'style.css', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'og.png',
    'docs/hero.webp', 'docs/phone.webp', 'js', 'icons',
]

fs.rmSync(out, {recursive: true, force: true})
for (const f of FILES) fs.cpSync(path.join(root, f), path.join(out, f), {recursive: true})
console.log(`dist/: ${FILES.join(', ')}`)
