import {
    CONTENTS_CACHE, forgetLoaded, getFileContent, getTimeline, listOpenPulls, listPullRequests, loadChangeSet, PACK_CACHE,
    packMemory, packUrl, setSnapshot, snapshotName, SNAP_CACHE, STORAGE_FULL,
} from './github.js'
import {languageForPath, loadMonaco, preloadForOffline} from './editor.js'
import {loadMarkdown} from './markdown.js'

const KEY = 'jd.offline'
const API_CACHE = 'jd-api' // kept by sw.js
// what "Remove all saved data" removes
const SAVED = [API_CACHE, CONTENTS_CACHE, PACK_CACHE, SNAP_CACHE]
const FFLATE = 'https://esm.sh/fflate@0.8.2'
const LANGUAGES = ['markdown', 'typescript', 'javascript', 'json', 'css', 'html', 'glsl', 'yaml', 'shellscript']

const sameRepo = (a, b) => a.owner === b.owner && a.repo === b.repo
const parseJson = (bytes) => JSON.parse(new TextDecoder().decode(bytes))
const encodeJson = (v) => new TextEncoder().encode(JSON.stringify(v))

/** The downloaded repositories: [{owner, repo, prs: [{number, title}], commits, at}], newest first. */
export function offlineRepos() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function saveRepos(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* no storage */ }
}

// Runs `tasks` `n` at a time and returns how many failed. Tasks may add tasks while it runs, so a worker with
// nothing left waits for the running ones before it stops.
async function pool(tasks, n, onDone, signal) {
    let i = 0, failed = 0, running = 0
    const worker = async () => {
        for (;;) {
            if (signal?.aborted) return
            if (i < tasks.length) {
                const t = tasks[i++]
                running++
                try { await t() } catch { failed++ }
                running--
                onDone()
            } else if (running === 0) return
            else await new Promise((r) => setTimeout(r, 50))
        }
    }
    await Promise.all(Array.from({length: Math.max(1, Math.min(n, tasks.length))}, worker))
    return failed
}

// what the page loads on demand: Monaco, the grammars, both themes, Markdown, the fonts
async function preloadApp(languages) {
    const monaco = await loadMonaco()
    await Promise.all([preloadForOffline(monaco, languages), loadMarkdown(), cacheFonts()])
}

const keepStorage = async () => {
    try { await navigator.storage?.persist?.() } catch { /* the browser decides */ }
}

/**
 * Downloads a repository's open pull requests (or `numbers`) for offline use. Returns {prs, failed, aborted?, full?}:
 * `prs` counts the pull requests saved, which are then listed as available offline; `full`: the storage is full, and
 * the download stopped.
 */
export async function downloadRepo(owner, repo, {numbers = null, commits = true, onProgress = () => {}, signal} = {}) {
    await keepStorage()
    // stopped by the user (`signal`) or by a full storage
    const ctl = new AbortController()
    const stop = () => ctl.abort()
    if (signal?.aborted) stop()
    signal?.addEventListener('abort', stop)
    // the pull requests with work under way or waiting: not saved once the storage is full
    const pending = new Map(), spoiled = new Set()
    let full = false
    const onFull = () => {
        full = true
        for (const [n, k] of pending) if (k > 0) spoiled.add(n)
        stop()
    }
    window.addEventListener(STORAGE_FULL, onFull)
    const task = (n, fn) => {
        pending.set(n, (pending.get(n) || 0) + 1)
        return async () => {
            try { await fn() } finally { pending.set(n, pending.get(n) - 1) }
        }
    }
    try {
        const opts = {signal: ctl.signal}
        let done = 0, total = 1
        const tick = (step) => { done++; onProgress({done, total, step}) }
        onProgress({done, total, step: 'Pull request lists'})
        const lists = {}
        for (const state of ['open', 'closed', 'merged', 'all']) lists[state] = await listPullRequests(owner, repo, {state, ...opts}).catch(() => [])
        // the search lists stop at 50
        const prs = numbers ? lists.all.filter((p) => numbers.includes(p.number)) : await listOpenPulls(owner, repo, opts).catch(() => lists.open)
        for (const n of numbers || []) if (!prs.some((p) => p.number === n)) prs.push({number: n, title: `#${n}`})
        tick('Pull request lists')

        const sets = []
        total += prs.length
        let failed = await pool(prs.map((p) => task(p.number, async () => {
            const cs = await loadChangeSet({type: 'pr', owner, repo, number: p.number}, opts)
            p.title = cs.title
            sets.push({cs, commits: commits ? (cs.commits || []).map((c) => c.sha) : []})
        })), 3, () => tick('Pull requests'), ctl.signal)

        const contents = (cs) => cs.files.flatMap((f) => [
            f.status !== 'added' && cs.baseSha ? () => getFileContent(owner, repo, cs.baseSha, f.prevPath || f.path, opts) : null,
            f.status !== 'removed' ? () => getFileContent(owner, repo, cs.headSha, f.path, opts) : null,
        ]).filter(Boolean).map((fn) => task(cs.pr.number, fn))
        const tasks = []
        const languages = new Set()
        for (const {cs, commits: shas} of sets) {
            for (const f of cs.files) languages.add(languageForPath(f.path))
            tasks.push(...contents(cs), task(cs.pr.number, async () => {
                // the timeline shows its people's pictures (avatars allow CORS: an opaque answer would cost ~7 MB of quota)
                const tl = await getTimeline(owner, repo, cs.pr.number, opts)
                const users = [cs.pr.user, ...(cs.commits || []).map((c) => c.author), ...tl.comments.map((c) => c.user), ...tl.reviews.map((r) => r.user), ...tl.inline.map((c) => c.user)]
                const urls = new Set(users.filter((u) => u?.avatar_url).map((u) => `${u.avatar_url}${u.avatar_url.includes('?') ? '&' : '?'}s=48`))
                await Promise.all([...urls].map((u) => fetch(u, {mode: 'cors', ...opts}).catch(() => {})))
            }))
            for (const sha of shas) {
                tasks.push(task(cs.pr.number, async () => {
                    const more = contents(await loadChangeSet({type: 'pr', owner, repo, number: cs.pr.number, commit: sha}, opts))
                    tasks.push(...more)
                    total += more.length
                }))
            }
        }
        total += tasks.length
        failed += await pool(tasks, 6, () => tick('Files and conversations'), ctl.signal)
        if (signal?.aborted) return {prs: 0, failed, aborted: true}

        if (!full) {
            total += 1
            try { await preloadApp([...languages, ...LANGUAGES]) } catch { failed++ }
            tick('Editor and languages')
        }

        // only the pull requests whose changes loaded, and whose files were all kept
        const saved = sets.map(({cs}) => cs.pr).filter((pr) => !spoiled.has(pr.number))
        const list = offlineRepos()
        const merged = new Map((list.find((r) => sameRepo(r, {owner, repo}))?.prs || []).map((p) => [p.number, p]))
        for (const pr of saved) merged.set(pr.number, {number: pr.number, title: pr.title})
        if (merged.size) {
            saveRepos([
                {owner, repo, prs: [...merged.values()].sort((a, b) => b.number - a.number), commits, at: Date.now()},
                ...list.filter((r) => !sameRepo(r, {owner, repo})),
            ])
        }
        return {prs: saved.length, failed, ...(full && {full})}
    } finally {
        signal?.removeEventListener('abort', stop)
        window.removeEventListener(STORAGE_FULL, onFull)
    }
}

/** Removes a repository's saved responses and contents. */
export async function removeRepo(owner, repo) {
    const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // its API paths and its searches (`repo:owner/name`), not those of a repository whose name starts the same
    const ours = new RegExp(`(?:/repos/|repo:)${re(owner)}/${re(repo)}(?![\\w.-])`, 'i')
    const decode = (u) => { try { return decodeURIComponent(u) } catch { return u } }
    try {
        for (const name of [API_CACHE, CONTENTS_CACHE]) {
            const cache = await caches.open(name)
            for (const req of await cache.keys()) if (ours.test(decode(req.url))) await cache.delete(req)
        }
    } catch { /* a sandboxed page has no Cache Storage */ }
    forgetLoaded(owner, repo)
    saveRepos(offlineRepos().filter((r) => !sameRepo(r, {owner, repo})))
}

/** Removes all saved GitHub data (not the app itself). */
export async function clearOffline() {
    try {
        for (const name of SAVED) await caches.delete(name)
    } catch { /* a sandboxed page has no Cache Storage */ }
    packMemory.clear()
    // what this tab read is read again: a download right after must save it
    forgetLoaded()
    setSnapshot('')
    saveRepos([])
}

/** Whether clearOffline has anything to remove: downloads, packs, and what browsing or a stopped download kept. */
export async function hasSavedData() {
    if (offlineRepos().length || packMemory.size || snapshotName() === 'pack') return true
    try {
        for (const name of SAVED) if (await caches.has(name)) return true
    } catch { /* a sandboxed page has no Cache Storage */ }
    return false
}

/** {usage, quota} in bytes, when the browser tells. */
export async function storageUse() {
    try { return await navigator.storage.estimate() } catch { return null }
}

/** Whether a service worker controls the page, so the app itself works offline. */
export function appOffline() {
    try { return !!navigator.serviceWorker?.controller } catch { return false }
}

/**
 * Imports an offline pack (a .zip of a snapshot, from tools/make-pack.py), merged with the packs imported before.
 * Returns {repos, files, persisted}: not persisted where the page has no Cache Storage (kept until the tab closes).
 */
export async function importPack(file, onProgress = () => {}) {
    await keepStorage()
    const {unzip, unzipSync} = await import(FFLATE)
    const buf = new Uint8Array(await file.arrayBuffer())
    onProgress('Unpacking', 0, 1)
    // the async unzip runs in Workers, which not every page can start
    const entries = await new Promise((resolve, reject) => {
        try { unzip(buf, (err, data) => err ? reject(err) : resolve(data)) } catch { try { resolve(unzipSync(buf)) } catch (e) { reject(e) } }
    })
    const indexPath = Object.keys(entries).find((k) => /(^|\/)index\.json$/.test(k) && !k.startsWith('__MACOSX'))
    if (!indexPath) throw new Error('Not an offline pack (no index.json)')
    const prefix = indexPath.slice(0, -'index.json'.length)
    const index = parseJson(entries[prefix + 'index.json'])
    const repos = entries[prefix + 'repos.json'] ? parseJson(entries[prefix + 'repos.json']) : []
    let cache = null
    try { cache = await caches.open(PACK_CACHE) } catch { /* sandboxed: memory */ }
    const read = async (k) => {
        if (packMemory.has(k)) return parseJson(packMemory.get(k))
        const hit = cache && await cache.match(packUrl(k))
        return hit ? hit.json() : null
    }
    const put = async (k, bytes) => cache ? cache.put(packUrl(k), new Response(bytes)) : packMemory.set(k, bytes)
    const files = Object.keys(entries).filter((k) => k.startsWith(prefix) && !k.endsWith('/') && !k.endsWith('index.json') && !k.endsWith('repos.json'))
    for (let i = 0; i < files.length; i++) {
        await put(files[i].slice(prefix.length), entries[files[i]])
        if (i % 200 === 0) onProgress('Saving', i, files.length)
    }
    const isNew = (r) => repos.some((n) => sameRepo(n, r))
    const oldIndex = await read('index.json') || {}
    const oldRepos = (await read('repos.json') || []).filter((r) => !isNew(r))
    await put('index.json', encodeJson({...oldIndex, ...index}))
    await put('repos.json', encodeJson([...oldRepos, ...repos]))
    setSnapshot('pack')
    // offline, the editor and the grammars come from the saved app
    if (navigator.onLine) {
        try { await preloadApp(LANGUAGES) } catch { /* later */ }
    }
    const list = offlineRepos().filter((r) => !isNew(r))
    saveRepos([...repos.map((r) => ({...r, commits: true, at: Date.now(), pack: true})), ...list])
    return {repos, files: files.length, persisted: !!cache}
}

// the service worker keeps what the page fetched: the web fonts' stylesheet and their files
async function cacheFonts() {
    for (const link of document.querySelectorAll('link[rel="stylesheet"][href^="https://fonts.googleapis.com"]')) {
        try {
            const css = await (await fetch(link.href)).text()
            const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1])
            await Promise.all(urls.map((u) => fetch(u, {mode: 'cors'}).catch(() => {})))
        } catch { /* offline: later */ }
    }
}
