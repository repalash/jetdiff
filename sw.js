// The page keeps file contents at a commit (jd-contents-v1), snapshot files (jd-snap) and packs (jd-pack) itself; this
// worker keeps the app's own files and pages, its libraries and the GitHub API responses (not branch refs).

const VERSION = 'v7'
const SHELL = 'jd-shell-' + VERSION
const LIBS = 'jd-libs'
const API = 'jd-api'
const KEEP = [SHELL, LIBS, API, 'jd-contents-v1', 'jd-pack', 'jd-snap']

const SHELL_FILES = [
    './', './index.html', './404.html', './style.css', './manifest.webmanifest', './docs/hero.webp', './docs/phone.webp',
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
        // kept by earlier versions: snapshot files and packs (the page keeps those), and opaque avatars (~7 MB of quota
        // each; the libraries are replaced as they are used)
        const shellCache = await caches.open(SHELL)
        for (const req of await shellCache.keys()) if (!appPaths().has(new URL(req.url).pathname)) await shellCache.delete(req)
        const libs = await caches.open(LIBS)
        for (const req of await libs.keys()) {
            if (new URL(req.url).host === 'avatars.githubusercontent.com' && (await libs.match(req))?.type === 'opaque') await libs.delete(req)
        }
        await self.clients.claim()
    })())
})

let paths
const appPaths = () => paths ??= new Set(SHELL_FILES.map((f) => new URL(f, self.registration.scope).pathname))

/** The app's own files, and its pages (a GitHub-style path is one: 404.html turns it into the app's URL). */
function isApp(req, url) {
    const scope = new URL('./', self.registration.scope).pathname
    if (!url.pathname.startsWith(scope) || url.pathname.startsWith(scope + 'auth/')) return false
    return req.mode === 'navigate' ? !/\.(zip|json)$/i.test(url.pathname) : appPaths().has(url.pathname)
}

self.addEventListener('fetch', (e) => {
    const req = e.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    if (url.origin === location.origin) {
        if (isApp(req, url)) e.respondWith(shell(req))
    } else if (url.host === 'api.github.com') {
        // raw file contents are cached by the page; a branch ref is never answered from a saved copy, as commits are
        // checked against it
        if (!(req.headers.get('accept') || '').includes('raw') && !/\/git\/refs?\//.test(url.pathname)) e.respondWith(api(req))
    } else if (LIB_HOSTS.has(url.host) && !url.pathname.endsWith('.zip')) {
        // offline packs are imported into their own cache: not kept twice
        e.respondWith(lib(e))
    }
})

const timeout = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms))

// `res`: the network's answer, as soon as it starts; `saved`: the same once it is kept (marked when the storage is full)
function fetchAndSave(req, cache, key) {
    const res = fetch(req)
    const saved = res.then(async (r) => {
        if (!r.ok) return r
        try {
            await cache.put(key, r.clone())
        } catch (e) {
            if (e?.name === 'QuotaExceededError') return unsaved(r)
        }
        return r
    })
    saved.catch(() => {})
    return {res, saved}
}

// the page tells the user that the storage is full (github.js)
function unsaved(res) {
    const h = new Headers(res.headers)
    h.set('x-jd-unsaved', 'quota')
    h.set('access-control-expose-headers', [h.get('access-control-expose-headers'), 'x-jd-unsaved'].filter(Boolean).join(', '))
    return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h})
}

// fresh from the network within 3 s, so updates arrive; else the saved copy
async function shell(req) {
    const cache = await caches.open(SHELL)
    const {res, saved} = fetchAndSave(req, cache, stripQuery(req))
    const first = await Promise.race([res.catch(() => null), timeout(3000)])
    // only a good answer wins over the saved copy (a dead tunnel or proxy answers with an error page)
    if (first && first !== 'timeout' && first.ok) return saved
    const hit = await cache.match(stripQuery(req)) || await cache.match(req, {ignoreSearch: true})
        // a GitHub-style path (/owner/repo/pull/1): 404.html turns it into the app's URL
        || req.mode === 'navigate' && await cache.match(new URL('./404.html', self.registration.scope).href)
    // a new Response keeps the requested URL (a saved one would carry the URL it was saved under)
    if (hit) return new Response(hit.body, {status: hit.status, statusText: hit.statusText, headers: hit.headers})
    return first && first !== 'timeout' ? first : saved
}

// `index.html?pr=…` and `./?pr=…` are the same page
function stripQuery(req) {
    const u = new URL(req.url)
    if (!u.pathname.endsWith('/') && !u.pathname.endsWith('.html')) return req
    u.search = ''
    return new Request(u.href)
}

// An opaque answer (a script, stylesheet or image asked for without CORS) costs ~7 MB of quota whatever its size, so it
// is never kept: these hosts allow CORS, and the worker asks with it. A copy kept opaque by an earlier version is
// replaced while online.
async function lib(e) {
    const req = e.request
    const cache = await caches.open(LIBS)
    const hit = await cache.match(req)
    if (hit && hit.type !== 'opaque') return hit
    let res
    try {
        res = await fetch(req.mode === 'no-cors' ? new Request(req.url, {mode: 'cors', credentials: 'omit'}) : req)
    } catch {
        return hit || fetch(req)
    }
    if (res.ok) e.waitUntil(cache.put(req, res.clone()).catch(() => {}))
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
    const {res, saved} = fetchAndSave(req, cache, key)
    const first = await Promise.race([res.catch((e) => e), timeout(8000)])
    if (first instanceof Response) return saved
    const hit = await cache.match(key)
    if (hit) return offlineCopy(hit)
    if (first === 'timeout') return saved.catch(() => notSaved())
    return notSaved()
}

function notSaved() {
    return new Response(JSON.stringify({message: 'Offline, and this was not downloaded for offline'}), {
        status: 503,
        headers: {'content-type': 'application/json', ...OFFLINE_HEADERS},
    })
}
