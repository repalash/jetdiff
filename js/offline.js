import {
    CONTENTS_CACHE, getFileContent, getTimeline, listOpenPulls, listPullRequests, loadChangeSet, PACK_CACHE, packMemory,
    packUrl, setSnapshot, SNAP_CACHE,
} from './github.js'
import {languageForPath, loadMonaco, preloadForOffline} from './editor.js'
import {loadMarkdown} from './markdown.js'

const KEY = 'jd.offline'
const API_CACHE = 'jd-api' // kept by sw.js
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

/** Downloads a repository's open pull requests (or `numbers`) for offline use. Returns {prs, failed, aborted?}. */
export async function downloadRepo(owner, repo, {numbers = null, commits = true, onProgress = () => {}, signal} = {}) {
    try { await navigator.storage?.persist?.() } catch { /* the browser decides */ }
    let done = 0, total = 1
    const tick = (step) => { done++; onProgress({done, total, step}) }
    onProgress({done, total, step: 'Pull request lists'})
    const lists = {}
    for (const state of ['open', 'closed', 'merged', 'all']) lists[state] = await listPullRequests(owner, repo, {state}).catch(() => [])
    // the search lists stop at 50
    const prs = numbers ? lists.all.filter((p) => numbers.includes(p.number)) : await listOpenPulls(owner, repo).catch(() => lists.open)
    for (const n of numbers || []) if (!prs.some((p) => p.number === n)) prs.push({number: n, title: `#${n}`})
    tick('Pull request lists')

    const sets = []
    total += prs.length
    let failed = await pool(prs.map((p) => async () => {
        const cs = await loadChangeSet({type: 'pr', owner, repo, number: p.number})
        p.title = cs.title
        sets.push({cs, commits: commits ? (cs.commits || []).map((c) => c.sha) : []})
    }), 3, () => tick('Pull requests'), signal)

    const contents = (cs) => cs.files.flatMap((f) => [
        f.status !== 'added' && cs.baseSha ? () => getFileContent(owner, repo, cs.baseSha, f.prevPath || f.path) : null,
        f.status !== 'removed' ? () => getFileContent(owner, repo, cs.headSha, f.path) : null,
    ]).filter(Boolean)
    const tasks = []
    const languages = new Set()
    for (const {cs, commits: shas} of sets) {
        for (const f of cs.files) languages.add(languageForPath(f.path))
        tasks.push(...contents(cs), async () => {
            // the timeline shows its people's pictures
            const tl = await getTimeline(owner, repo, cs.pr.number)
            const users = [cs.pr.user, ...(cs.commits || []).map((c) => c.author), ...tl.comments.map((c) => c.user), ...tl.reviews.map((r) => r.user), ...tl.inline.map((c) => c.user)]
            const urls = new Set(users.filter((u) => u?.avatar_url).map((u) => `${u.avatar_url}${u.avatar_url.includes('?') ? '&' : '?'}s=48`))
            await Promise.all([...urls].map((u) => fetch(u, {mode: 'no-cors'}).catch(() => {})))
        })
        for (const sha of shas) {
            tasks.push(async () => {
                const more = contents(await loadChangeSet({type: 'pr', owner, repo, number: cs.pr.number, commit: sha}))
                tasks.push(...more)
                total += more.length
            })
        }
    }
    total += tasks.length
    failed += await pool(tasks, 6, () => tick('Files and conversations'), signal)
    if (signal?.aborted) return {prs: 0, failed, aborted: true}

    total += 1
    try { await preloadApp([...languages, ...LANGUAGES]) } catch { failed++ }
    tick('Editor and languages')

    const saved = offlineRepos()
    const merged = new Map((saved.find((r) => sameRepo(r, {owner, repo}))?.prs || []).map((p) => [p.number, p]))
    for (const p of prs) merged.set(p.number, {number: p.number, title: p.title})
    saveRepos([
        {owner, repo, prs: [...merged.values()].sort((a, b) => b.number - a.number), commits, at: Date.now()},
        ...saved.filter((r) => !sameRepo(r, {owner, repo})),
    ])
    return {prs: prs.length, failed}
}

/** Removes a repository's saved responses and contents. */
export async function removeRepo(owner, repo) {
    const path = `/repos/${owner}/${repo}/`
    const q = encodeURIComponent(`repo:${owner}/${repo}`).toLowerCase()
    for (const name of [API_CACHE, CONTENTS_CACHE]) {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) {
            const u = decodeURIComponent(req.url)
            if (u.includes(path) || req.url.toLowerCase().includes(q) || u.includes(`repo:${owner}/${repo}`)) await cache.delete(req)
        }
    }
    saveRepos(offlineRepos().filter((r) => !sameRepo(r, {owner, repo})))
}

/** Removes all saved GitHub data (not the app itself). */
export async function clearOffline() {
    try {
        for (const name of [API_CACHE, CONTENTS_CACHE, PACK_CACHE, SNAP_CACHE]) await caches.delete(name)
    } catch { /* a sandboxed page has no Cache Storage */ }
    packMemory.clear()
    setSnapshot('')
    saveRepos([])
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
