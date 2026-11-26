#!/usr/bin/env node
// What the site serves, written into dist/ by the build (build.mjs): the app's own files, the libraries copied as they
// are from node_modules to vendor/<name>/<version>/, and the service worker with its release.
// `npm run vendor` writes the libraries' versions into index.html (the import map, the font stylesheets) and the import
// map's hash into the Content Security Policy (worker/headers.js); run it after changing a library's version.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE_MODULES = path.join(ROOT, 'node_modules')
const HEADERS_MODULE = path.join(ROOT, 'worker/headers.js')

/** The app's own files and folders, served as they are (sw.js is written: serviceWorker()). */
export const FILES = [
    'index.html', '404.html', 'style.css', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'og.png',
    'docs/hero.webp', 'docs/phone.webp', 'js', 'icons',
]

/**
 * What the service worker keeps of each release, fetched together at install (sw.js). The pages at the URLs Cloudflare's
 * asset server answers them at, with no redirect: index.html at ./, 404.html at ./404.
 */
export const SHELL_FILES = [
    './', './404', './style.css', './manifest.webmanifest', './docs/hero.webp', './docs/phone.webp',
    './js/main.js', './js/github.js', './js/editor.js', './js/themes.js', './js/sbs.js', './js/tree.js', './js/icons.js',
    './js/log.js', './js/palette.js', './js/markdown.js', './js/tooltip.js', './js/steps.js', './js/offline.js', './js/util.js',
    './js/update.js', './js/redirect.js', './js/support.js', './js/keymap.js', './js/goto.js', './js/declarations.js', './js/typescript.js',
    './icons/icon.svg', './icons/icon-small.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
]

// The ES modules the app imports by name (the import map), with all they import in turn
const MODULES = ['shiki/core', 'shiki/engine/javascript', 'shiki/langs', 'markdown-it', 'dompurify', 'fflate']
// Imported by a path under the package (an import map prefix): what is copied, and what the page loads on start
const PREFIXES = {
    // Monaco's AMD build, loaded by its own loader from vendor/monaco-editor/<version>/min/vs
    'monaco-editor/': {
        files: (rel) => rel.startsWith('min/vs/'),
        start: ['min/vs/loader.js', 'min/vs/editor/editor.main.js', 'min/vs/editor/editor.main.css',
            'min/vs/base/worker/workerMain.js', 'min/vs/base/browser/ui/codicons/codicon/codicon.ttf'],
    },
    // every grammar, as a file can be in any language; loaded when first used
    '@shikijs/langs/': {files: (rel) => /^dist\/[^/]+\.mjs$/.test(rel) && rel !== 'dist/index.mjs', start: []},
    // the two base themes of the Material variants (editor.js)
    '@shikijs/themes/': {
        files: (rel) => ['dist/material-theme-darker.mjs', 'dist/material-theme-lighter.mjs'].includes(rel),
        start: ['dist/material-theme-darker.mjs', 'dist/material-theme-lighter.mjs'],
    },
}
// The web fonts' stylesheets (index.html links them) and their woff2 files; their woff fallbacks are not copied, as
// every browser the app runs in reads woff2
const STYLES = [
    '@fontsource/inter/400.css', '@fontsource/inter/500.css', '@fontsource/inter/600.css',
    '@fontsource/jetbrains-mono/400.css', '@fontsource/jetbrains-mono/600.css', '@fontsource/jetbrains-mono/400-italic.css',
]

const packages = new Map()
function pkg(name) {
    if (!packages.has(name)) {
        const dir = path.join(NODE_MODULES, name)
        let json
        try { json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch {
            throw new Error(`${name} is not in node_modules: run npm install`)
        }
        packages.set(name, {name, dir, version: json.version, json})
    }
    return packages.get(name)
}

const nameOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
// vendor/<name>/<version>/, a scope as a folder (@fontsource/inter: vendor/fontsource/inter/5.3.0/): no @ in a URL, as
// Cloudflare's asset server answers a path that encodeURIComponent changes with a redirect to the encoded one
const vendorDir = (p) => `vendor/${p.name.replace(/^@/, '')}/${p.version}/`
const vendorPath = (p, rel) => vendorDir(p) + rel

// A bare specifier's file, by the package's "exports" (the browser's or the ES module's), as a bundler would find it
function resolve(spec) {
    const p = pkg(nameOf(spec))
    const sub = '.' + spec.slice(p.name.length)
    const pick = (e) => typeof e === 'string' ? e : e && (pick(e.browser) || pick(e.import) || pick(e.module) || pick(e.default))
    let target
    const ex = p.json.exports
    if (ex) target = pick(typeof ex === 'string' || !Object.keys(ex).some((k) => k.startsWith('.')) ? (sub === '.' ? ex : null) : ex[sub])
    else target = sub === '.' ? p.json.module || p.json.main || 'index.js' : sub
    if (!target) throw new Error(`${spec}: not exported by ${p.name}`)
    return {p, rel: path.posix.normalize(target)}
}

// import and export statements with a source, in the built ES modules the libraries ship
const STATIC_IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"]([^'"]+)['"]/g

let vendored
/**
 * The libraries: `files` (published path -> file in node_modules), `start` (what the page loads on start, kept by the
 * service worker at install) and `importMap`.
 */
export function vendor() {
    if (vendored) return vendored
    const files = new Map(), start = new Set(), imports = {}
    const add = (p, rel, onStart) => {
        const url = vendorPath(p, rel)
        files.set(url, path.join(p.dir, rel))
        if (onStart) start.add(url)
        return url
    }
    const walk = (p, rel) => {
        const url = vendorPath(p, rel)
        if (files.has(url)) return
        add(p, rel, true)
        const src = fs.readFileSync(path.join(p.dir, rel), 'utf8')
        for (const [, spec] of src.matchAll(STATIC_IMPORT)) {
            if (spec.startsWith('.')) { walk(p, path.posix.join(path.posix.dirname(rel), spec)); continue }
            const r = resolve(spec)
            imports[spec] = './' + vendorPath(r.p, r.rel)
            walk(r.p, r.rel)
        }
    }
    for (const spec of MODULES) {
        const r = resolve(spec)
        imports[spec] = './' + vendorPath(r.p, r.rel)
        walk(r.p, r.rel)
    }
    for (const [prefix, {files: keep, start: onStart}] of Object.entries(PREFIXES)) {
        const p = pkg(prefix.slice(0, -1))
        imports[prefix] = './' + vendorDir(p)
        for (const rel of listFiles(p.dir)) if (keep(rel)) add(p, rel, onStart.includes(rel))
        for (const rel of onStart) if (!files.has(vendorPath(p, rel))) throw new Error(`${p.name}: no ${rel}`)
    }
    for (const style of STYLES) {
        const {p, rel} = {p: pkg(nameOf(style)), rel: style.slice(nameOf(style).length + 1)}
        add(p, rel, true)
        const css = fs.readFileSync(path.join(p.dir, rel), 'utf8')
        for (const [, font] of css.matchAll(/url\(([^)]+\.woff2)\)/g)) add(p, path.posix.join(path.posix.dirname(rel), font), true)
    }
    const sorted = Object.fromEntries(Object.entries(imports).sort(([a], [b]) => a < b ? -1 : 1))
    vendored = {files, start: [...start].sort(), importMap: {imports: sorted}, stylesheets: STYLES.map((s) => vendorPath(pkg(nameOf(s)), s.slice(nameOf(s).length + 1)))}
    return vendored
}

function listFiles(dir, rel = '') {
    const out = []
    for (const e of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...listFiles(dir, r)) } else out.push(r)
    }
    return out
}

// index.html's import map: the one inline script of the app, allowed by its hash (worker/headers.js)
const IMPORT_MAP = /(<script type="importmap">)([\s\S]*?)(<\/script>)/
const importMapText = () => '\n' + JSON.stringify(vendor().importMap, null, 4).replace(/^/gm, '    ') + '\n    '
export const scriptHash = (text) => `sha256-${crypto.createHash('sha256').update(text).digest('base64')}`

/** index.html with the libraries' current import map and versions. */
function currentIndex(html) {
    vendor()
    // vendor/<name>/<version>/: two folders before the version are a scope and a name
    return html.replace(IMPORT_MAP, (m, a, b, c) => a + importMapText() + c)
        .replace(/vendor\/([\w.-]+(?:\/[\w.-]+)??)\/\d+\.\d+\.\d+[\w.-]*\//g, (m, dir) => vendorDir(pkg(dir.includes('/') ? '@' + dir : dir)))
}

/** Why index.html or the Content Security Policy does not match node_modules (run npm run vendor), or null. */
export async function checkVendor() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    if (currentIndex(html) !== html) return 'index.html does not name the installed libraries: run npm run vendor'
    const {IMPORT_MAP_HASH} = await import(pathToFileURL(HEADERS_MODULE).href)
    if (IMPORT_MAP_HASH !== scriptHash(html.match(IMPORT_MAP)[2])) return 'IMPORT_MAP_HASH in worker/headers.js is not the import map\'s: run npm run vendor'
    for (const s of vendor().stylesheets) if (!html.includes(`href="./${s}"`)) return `index.html does not link ${s}`
    return null
}

const PAGES = {'./': 'index.html', './404': '404.html'}
const read = (f) => fs.readFileSync(path.join(ROOT, PAGES[f] || f))

/**
 * sw.js with its release: a hash of the release's files, the worker's own code, the libraries it keeps and the security
 * headers (worker/headers.js), as the release's pages are kept with the headers they had, their policy included.
 */
export function serviceWorker() {
    const template = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    const libs = vendor().start.map((f) => './' + f)
    const hash = crypto.createHash('sha256').update(template).update(JSON.stringify(libs)).update(fs.readFileSync(HEADERS_MODULE))
    for (const f of SHELL_FILES) hash.update(`\0${f}\0`).update(read(f))
    const release = hash.digest('hex').slice(0, 16)
    const list = (a) => JSON.stringify(a)
    return template
        .replace(/^const RELEASE = .*$/m, `const RELEASE = '${release}'`)
        .replace(/^const SHELL_FILES = .*$/m, `const SHELL_FILES = ${list(SHELL_FILES)}`)
        .replace(/^const LIB_FILES = .*$/m, `const LIB_FILES = ${list(libs)}`)
}

// npm run vendor; with --check, only says whether it is due (CI)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv[2] === '--check') {
        const stale = await checkVendor()
        if (stale) {
            console.error(stale)
            process.exit(1)
        }
    } else {
        const file = path.join(ROOT, 'index.html')
        const html = currentIndex(fs.readFileSync(file, 'utf8'))
        fs.writeFileSync(file, html)
        const headers = fs.readFileSync(HEADERS_MODULE, 'utf8')
        fs.writeFileSync(HEADERS_MODULE, headers.replace(/(export const IMPORT_MAP_HASH = ')[^']*(')/, `$1${scriptHash(html.match(IMPORT_MAP)[2])}$2`))
        console.log(`index.html and worker/headers.js name ${[...packages.values()].map((p) => `${p.name}@${p.version}`).join(', ')}`)
    }
}
