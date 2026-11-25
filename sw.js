// The page keeps file contents at a commit (jd-contents-v1), snapshot files from a URL (jd-snap) and packs (jd-pack)
// itself; this worker keeps the app, its libraries and the GitHub API responses.

const VERSION = 'v6'
const SHELL = 'jd-shell-' + VERSION
const LIBS = 'jd-libs'
const API = 'jd-api'
const KEEP = [SHELL, LIBS, API, 'jd-contents-v1', 'jd-pack', 'jd-snap']

const SHELL_FILES = [
    './', './index.html', './style.css', './manifest.webmanifest',
    './js/main.js', './js/github.js', './js/editor.js', './js/themes.js', './js/sbs.js', './js/tree.js', './js/icons.js',
    './js/log.js', './js/palette.js', './js/markdown.js', './js/tooltip.js', './js/offline.js', './js/monaco-worker.js', './js/util.js',
    './icons/icon.svg', './icons/icon-small.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
]
// libraries at fixed versions, fonts and avatars: they never change
const LIB_HOSTS = new Set([
    'cdn.jsdelivr.net', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com', 'avatars.githubusercontent.com',
])
const OFFLINE_HEADERS = {'x-jd-offline': '1', 'access-control-expose-headers': 'x-jd-offline'}

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith('jd-') && !KEEP.includes(k)) await caches.delete(k)
        await self.clients.claim()
    })())
})

self.addEventListener('fetch', (e) => {
    const req = e.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    if (url.origin === location.origin) {
        if (url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) e.respondWith(shell(req))
    } else if (url.host === 'api.github.com') {
        // raw file contents are cached by the page
        if (!(req.headers.get('accept') || '').includes('raw')) e.respondWith(api(req))
    } else if (LIB_HOSTS.has(url.host) && !url.pathname.endsWith('.zip')) {
        // offline packs are imported into their own cache: not kept twice
        e.respondWith(lib(req))
    }
})

const timeout = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms))

const fetchAndSave = (req, cache, key) => fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone())
    return res
})

// fresh from the network within 3 s, so updates arrive; else the saved copy
async function shell(req) {
    const cache = await caches.open(SHELL)
    const net = fetchAndSave(req, cache, stripQuery(req))
    const first = await Promise.race([net.catch(() => null), timeout(3000)])
    // only a good answer wins over the saved copy (a dead tunnel or proxy answers with an error page)
    if (first && first !== 'timeout' && first.ok) return first
    const hit = await cache.match(stripQuery(req)) || await cache.match(req, {ignoreSearch: true})
    // a new Response keeps the requested URL (a saved one would carry the URL it was saved under)
    if (hit) return new Response(hit.body, {status: hit.status, statusText: hit.statusText, headers: hit.headers})
    return first && first !== 'timeout' ? first : net
}

// `index.html?pr=…` and `./?pr=…` are the same page
function stripQuery(req) {
    const u = new URL(req.url)
    if (!u.pathname.endsWith('/') && !u.pathname.endsWith('.html')) return req
    u.search = ''
    return new Request(u.href)
}

async function lib(req) {
    const cache = await caches.open(LIBS)
    const hit = await cache.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
    return res
}

// one URL can answer as JSON or with HTML bodies, by the Accept header
function apiKey(req) {
    const u = new URL(req.url)
    return `https://offline.jd/${encodeURIComponent(req.headers.get('accept') || '')}${u.pathname}${u.search}`
}

// the page tells the user it shows a saved copy
function offlineCopy(res) {
    const h = new Headers(res.headers)
    for (const [k, v] of Object.entries(OFFLINE_HEADERS)) h.set(k, v)
    return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h})
}

// the network first; offline, or slower than 8 s, the saved copy
async function api(req) {
    const cache = await caches.open(API)
    const key = apiKey(req)
    const net = fetchAndSave(req, cache, key)
    const first = await Promise.race([net.catch((e) => e), timeout(8000)])
    if (first instanceof Response) return first
    const hit = await cache.match(key)
    if (hit) return offlineCopy(hit)
    if (first === 'timeout') return net.catch(() => notSaved())
    return notSaved()
}

function notSaved() {
    return new Response(JSON.stringify({message: 'Offline, and this was not downloaded for offline'}), {
        status: 503,
        headers: {'content-type': 'application/json', ...OFFLINE_HEADERS},
    })
}
