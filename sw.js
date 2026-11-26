// The offline app, updated a whole release at a time. At install, a release's files are fetched together into their
// own cache (jd-shell-<release>), and the worker takes over only once all of them have arrived. A page then keeps the
// release it was loaded with until it reloads (js/update.js tells it a new one is ready), so it never mixes the files
// of two releases. The libraries (vendor/<name>@<version>/…) never change at a URL: they are kept once, in jd-libs,
// those the page starts with at install and the others (grammars) when first used.
// The page keeps file contents at a commit (jd-contents-v1), snapshot files (jd-snap) and packs (jd-pack) itself; this
// worker also keeps the GitHub API responses (not branch refs) and avatars.

// The release: written by tools/site.mjs where the site is served or built (npm start, npm run build)
const RELEASE = 'unbuilt'
const SHELL_FILES = []
const LIB_FILES = []

const SHELL = 'jd-shell-'
const CURRENT = SHELL + RELEASE
const LIBS = 'jd-libs'
const API = 'jd-api'
const KEEP = [LIBS, API, 'jd-contents-v1', 'jd-pack', 'jd-snap']
// avatars never change at a URL either
const LIB_HOSTS = new Set(['avatars.githubusercontent.com'])
// where the libraries came from before the site served them
const OLD_LIB_HOSTS = new Set(['cdn.jsdelivr.net', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com'])
const OFFLINE_HEADERS = {'x-jd-offline': '1', 'access-control-expose-headers': 'x-jd-offline'}

const scoped = (f) => new URL(f, self.registration.scope).href

self.addEventListener('install', (e) => e.waitUntil(install()))

async function install() {
    const shell = await caches.open(CURRENT)
    await shell.addAll(SHELL_FILES.map((f) => new Request(f, {cache: 'no-cache'})))
    const libs = await caches.open(LIBS)
    await Promise.all(LIB_FILES.map(async (f) => {
        if (await libs.match(f)) return
        const res = await fetch(f)
        if (!res.ok) throw new Error(`${f}: ${res.status}`)
        await libs.put(f, res)
    }))
    // a deploy during the install can have mixed two releases: kept only if this one is still the one served
    const live = await (await fetch(self.location.href, {cache: 'no-store'})).text()
    if (!live.includes(`const RELEASE = '${RELEASE}'`)) {
        await caches.delete(CURRENT)
        throw new Error('A newer release arrived during the install')
    }
    await self.skipWaiting()
}

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith('jd-') && !k.startsWith(SHELL) && !KEEP.includes(k)) await caches.delete(k)
        // the libraries from before they came from the site, and opaque avatars kept by earlier versions (~7 MB of
        // quota each; replaced as they are used)
        const libs = await caches.open(LIBS)
        for (const req of await libs.keys()) {
            const host = new URL(req.url).host
            if (OLD_LIB_HOSTS.has(host) || LIB_HOSTS.has(host) && (await libs.match(req))?.type === 'opaque') await libs.delete(req)
        }
        // a page loaded before a worker controlled it has the release just installed (or one no longer known)
        const current = await caches.open(CURRENT)
        for (const c of await self.clients.matchAll({includeUncontrolled: true})) {
            if (await releaseOf(c.id) === CURRENT) await current.put(clientKey(c.id), new Response(''))
        }
        await self.clients.claim()
        await prune()
    })())
})

// The release each page was loaded with: kept in that release's cache too, as this worker can be stopped and started
// again while the page stays open
const releases = new Map() // client id -> cache name
const clientKey = (id) => `https://client.jd/${encodeURIComponent(id)}`
const clientOf = (url) => url.startsWith('https://client.jd/') ? decodeURIComponent(url.slice('https://client.jd/'.length)) : null

async function releaseOf(id) {
    if (!id) return CURRENT
    if (!releases.has(id)) {
        let name = CURRENT
        for (const k of await caches.keys()) {
            if (k.startsWith(SHELL) && await caches.match(clientKey(id), {cacheName: k})) { name = k; break }
        }
        releases.set(id, name)
    }
    return releases.get(id)
}

// set when a page loads: the page it replaces (a reload) is gone by the time the new one asks for its files
let pruneDue = false

function remember(e) {
    const id = e.resultingClientId
    if (!id) return
    releases.set(id, CURRENT)
    pruneDue = true
    e.waitUntil(caches.open(CURRENT).then((c) => c.put(clientKey(id), new Response(''))).catch(() => {}))
}

// An older release's cache stays while a page uses it. The newest one's pages are not looked at: one being loaded is
// not listed among the clients yet.
async function prune() {
    const open = new Set((await self.clients.matchAll({includeUncontrolled: true})).map((c) => c.id))
    for (const name of await caches.keys()) {
        if (!name.startsWith(SHELL) || name === CURRENT) continue
        const cache = await caches.open(name)
        let used = false
        for (const req of await cache.keys()) {
            const id = clientOf(req.url)
            if (id === null) continue
            if (open.has(id)) used = true
            else await cache.delete(req)
        }
        if (!used) await caches.delete(name)
    }
}

let paths
const appPaths = () => paths ??= new Set(SHELL_FILES.map((f) => new URL(f, self.registration.scope).pathname))

self.addEventListener('fetch', (e) => {
    const req = e.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    if (url.origin === location.origin) {
        const scope = new URL(self.registration.scope).pathname
        if (!url.pathname.startsWith(scope) || url.pathname.startsWith(scope + 'auth/')) return
        // snapshot files and packs are kept by the page
        if (req.mode === 'navigate') { if (!/\.(zip|json)$/i.test(url.pathname)) e.respondWith(page(e)) }
        else if (url.pathname.startsWith(scope + 'vendor/')) e.respondWith(lib(e))
        else if (appPaths().has(url.pathname)) e.respondWith(shell(e))
    } else if (url.host === 'api.github.com') {
        // raw file contents are cached by the page; a branch ref is never answered from a saved copy, as commits are
        // checked against it
        if (!(req.headers.get('accept') || '').includes('raw') && !/\/git\/refs?\//.test(url.pathname)) e.respondWith(api(req))
    } else if (LIB_HOSTS.has(url.host)) {
        e.respondWith(lib(e))
    }
})

// A page: the newest release's. A path that is not one of its pages is asked of the server, which knows whether it is
// a file (an image, robots.txt) or a GitHub-style path (/owner/repo/pull/1), which 404.html turns into the app's URL.
async function page(e) {
    const req = e.request
    let hit = await caches.match(stripQuery(req), {cacheName: CURRENT})
    if (!hit) {
        let res = null
        try { res = await fetch(req) } catch { /* offline */ }
        if (res && res.status !== 404) return res
        hit = await caches.match(scoped('./404.html'), {cacheName: CURRENT})
        if (!hit) return res || Response.error()
    }
    remember(e)
    // a new Response keeps the requested URL (a saved one would carry the URL it was saved under)
    return new Response(hit.body, {status: hit.status, statusText: hit.statusText, headers: hit.headers})
}

// one of the app's files, from the release of the page that asks
async function shell(e) {
    if (pruneDue) {
        pruneDue = false
        e.waitUntil(prune().catch(() => {}))
    }
    const hit = await caches.match(e.request, {cacheName: await releaseOf(e.clientId), ignoreSearch: true})
    return hit || fetch(e.request)
}

// `index.html?pr=…` and `./?pr=…` are the same page
function stripQuery(req) {
    const u = new URL(req.url)
    if (!u.pathname.endsWith('/') && !u.pathname.endsWith('.html')) return req
    u.search = ''
    return new Request(u.href)
}

// An opaque answer (a script, stylesheet or image asked for without CORS) costs ~7 MB of quota whatever its size, so it
// is never kept: avatars allow CORS, and the worker asks with it. A copy kept opaque by an earlier version is replaced
// while online.
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
