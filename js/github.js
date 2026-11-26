import {firstLine} from './util.js'

const API = 'https://api.github.com'
const FULL = 'application/vnd.github.full+json' // bodies also as GitHub's rendered HTML (body_html)
const TOKEN_KEY = 'jd.token'
const EXPIRES_KEY = 'jd.tokenExpires' // set for a token from Sign in with GitHub: it expires, and renews itself
const AUTH = new URL('../auth/', import.meta.url)
const SNAP_KEY = 'jd.snap'
const SNAP_NAME = SNAP_KEY + '='

export const PACK_CACHE = 'jd-pack'
export const CONTENTS_CACHE = 'jd-contents-v1'
export const SNAP_CACHE = 'jd-snap'

export function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

/** A pasted token (no expiry), or one from Sign in with GitHub (`expiresIn` seconds). */
export function setToken(token, expiresIn = 0) {
    try {
        token ? localStorage.setItem(TOKEN_KEY, token.trim()) : localStorage.removeItem(TOKEN_KEY)
        token && expiresIn ? localStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresIn * 1000)) : localStorage.removeItem(EXPIRES_KEY)
    } catch { /* no storage */ }
}

const tokenExpires = () => { try { return +localStorage.getItem(EXPIRES_KEY) || 0 } catch { return 0 } }

/** Whether the token came from Sign in with GitHub. */
export const signedIn = () => !!getToken() && !!tokenExpires()

let authConfigPromise
/** {clientId, appSlug} where this site offers Sign in with GitHub, else null. */
export function authConfig() {
    authConfigPromise ??= SNAP ? Promise.resolve(null)
        : fetch(new URL('config', AUTH)).then((r) => r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null).catch(() => null)
    return authConfigPromise
}

const SIGNIN_KEY = 'jd.signingIn'

export function signIn() {
    try { sessionStorage.setItem(SIGNIN_KEY, '1') } catch { /* no storage: the token from sign-in will be refused */ }
    location.assign(`${new URL('login', AUTH)}?return=${encodeURIComponent(location.pathname + location.search)}`)
}

/** Forgets the token; one from Sign in with GitHub goes to the Worker too, which revokes it at GitHub (a pasted one never leaves for this site). */
export async function signOut() {
    const token = signedIn() ? getToken() : ''
    setToken('')
    await fetch(new URL('logout', AUTH), {method: 'POST', ...token && {headers: {'content-type': 'application/json'}, body: JSON.stringify({token})}})
        .catch(() => {})
}

/** Takes the token Sign in with GitHub left in the URL fragment, if this tab started the sign-in; true if taken. */
export function takeSignInToken() {
    const params = new URLSearchParams(location.hash.slice(1))
    const token = params.get('jd-auth')
    if (!token) return false
    history.replaceState(history.state, '', location.pathname + location.search)
    // a link with someone else's token in the fragment must not replace the user's
    let started = false
    try {
        started = sessionStorage.getItem(SIGNIN_KEY) === '1'
        sessionStorage.removeItem(SIGNIN_KEY)
    } catch { /* no storage */ }
    if (started) setToken(token, +params.get('expires_in') || 0)
    return started
}

let refreshing
function renewToken() {
    refreshing ??= fetch(new URL('refresh', AUTH), {method: 'POST'})
        .then(async (r) => {
            if (!r.ok) throw new Error()
            const {access_token, expires_in} = await r.json()
            setToken(access_token, expires_in)
            return access_token
        })
        .catch(() => { setToken(''); return '' })
        .finally(() => { refreshing = null })
    return refreshing
}

// a signed-in token is renewed a minute before it expires
const currentToken = () => tokenExpires() && tokenExpires() - Date.now() < 60000 && getToken() ? renewToken() : getToken()

export class GitHubError extends Error {
    /** `retryAt`: when GitHub's rate limit allows the request again (ms since the epoch), if it said. */
    constructor(message, status, retryAt = 0) {
        super(message)
        this.status = status
        this.retryAt = retryAt
    }
}

/** A Cache Storage cache, or null: a sandboxed page has none. */
async function openCache(name) {
    try { return await caches.open(name) } catch { return null }
}

/** Told when something could not be saved for offline use because the storage is full (offline.js stops a download). */
export const STORAGE_FULL = 'jd-storage-full'
const storageFull = () => window.dispatchEvent(new CustomEvent(STORAGE_FULL))

/** Told when GitHub's hourly limit for requests without a token is used up: detail {resetAt} (ms since the epoch, or 0). */
export const RATE_LIMITED = 'jd-rate-limited'

/** Keeps `res` (ok) in `cache` under `url`; returns a response with the same body. */
async function keep(cache, url, res) {
    const buf = await res.arrayBuffer()
    try {
        await cache.put(url, new Response(buf, {headers: {'Content-Type': 'application/octet-stream'}}))
    } catch (e) {
        if (e?.name === 'QuotaExceededError') storageFull()
    }
    return new Response(buf, {status: res.status, statusText: res.statusText, headers: res.headers})
}

/** `load()`'s response for `url`, kept in the cache `name` (only for what never changes; never a pack's answer). */
async function cachedFetch(name, url, load) {
    const cache = await openCache(name)
    const hit = await cache?.match(url).catch(() => null)
    if (hit) return hit
    const res = await load()
    return cache && res.ok && !res.headers.get('x-jd-pack') ? keep(cache, url, res) : res
}

/** A promise kept in `map` under `key`, dropped when it fails (so a later call retries). */
function memo(map, key, load) {
    if (!map.has(key)) {
        const p = load()
        map.set(key, p)
        p.catch(() => map.delete(key))
    }
    return map.get(key)
}

/** An absolute https URL: what `?snap=` and `?packs=` take (anything else is ignored). */
export function httpsUrl(u) {
    try { return new URL(u).protocol === 'https:' } catch { return false }
}

/** An https URL on another site than this page's. */
export const otherSite = (u) => httpsUrl(u) && new URL(u).origin !== location.origin

// a `?snap=` link to another site's data waits for the user's yes (main.js asks)
let askSnap = ''

// `?snap=` is the https URL of a snapshot folder (empty leaves the snapshot). Kept in localStorage, as an installed app
// starts at ./ with no ?snap=; where a sandboxed page has no storage, in window.name, which lasts while the tab
// navigates.
let SNAP = (() => {
    let s = new URLSearchParams(location.search).get('snap')
    if (s && !httpsUrl(s)) s = null
    const wait = (kept) => {
        if (!s || s === kept || !otherSite(s)) return false
        askSnap = s
        return true
    }
    try {
        if (wait(localStorage.getItem(SNAP_KEY) || '')) s = null
        if (s !== null) s ? localStorage.setItem(SNAP_KEY, s) : localStorage.removeItem(SNAP_KEY)
        return localStorage.getItem(SNAP_KEY) || ''
    } catch { /* no storage (a sandboxed page): window.name keeps it instead; elsewhere any site could set it */ }
    if (wait(window.name.startsWith(SNAP_NAME) ? window.name.slice(SNAP_NAME.length) : '')) s = null
    if (s !== null) window.name = s ? SNAP_NAME + s : ''
    return s || (window.name.startsWith(SNAP_NAME) ? window.name.slice(SNAP_NAME.length) : '')
})()
// what storage or window.name holds is checked as a link's value is: anything but an https URL is no snapshot
if (!httpsUrl(SNAP)) SNAP = ''

/** The other site's snapshot URL a link asked to open, until the user answered (`answerSnapshot`); else ''. */
export const snapshotToAsk = () => askSnap

/** Opens the snapshot the link asked for (`yes`), or forgets the ask. */
export function answerSnapshot(yes) {
    if (yes && askSnap) setSnapshot(askSnap)
    askSnap = ''
}

const snapFile = (f) => new URL(f, SNAP.endsWith('/') ? SNAP : SNAP + '/')
export const snapshotName = () => SNAP

let snapDate = null
/** {host, date?} of the snapshot shown: where its data comes from, and when it was recorded if its server says. */
export async function snapshotInfo() {
    if (!SNAP) return null
    await loadSnapIndex().catch(() => {})
    return {host: new URL(SNAP).host, date: snapDate}
}

export const packUrl = (f) => `https://pack.jd/${f}`
/** Packs held in memory where the page has no Cache Storage: file -> bytes. */
export const packMemory = new Map()

/** A file of the imported packs, or null. */
async function packFile(f) {
    if (packMemory.has(f)) return new Response(packMemory.get(f))
    return await (await openCache(PACK_CACHE))?.match(packUrl(f)).catch(() => null) || null
}

let packIndex
/** Told when it changed: the packs' index is read again. */
export function forgetPackIndex() { packIndex = null }

/** Told with {url} when an imported pack answered for GitHub (main.js shows where the data comes from). */
export const PACK_ANSWER = 'jd-pack-answer'

/**
 * The imported packs' answer for a request GitHub could not answer (no network), or null when they do not hold it.
 * Marked `x-jd-pack`: recorded data, never kept as GitHub's.
 */
async function fromPack(url, method) {
    packIndex ??= packFile('index.json').then((r) => r ? r.json() : {}).catch(() => ({}))
    const e = (await packIndex)[snapKey(url, method)]
    if (!e) return null
    const res = await packFile(e.file)
    // a pack in parts, imported in part, has the whole index but not every file
    if (!res) throw new GitHubError('Not in the imported packs (a pack in parts needs all of them)', 404)
    window.dispatchEvent(new CustomEvent('jd-offline'))
    window.dispatchEvent(new CustomEvent(PACK_ANSWER, {detail: {url}}))
    return new Response(await res.arrayBuffer(), {status: e.status, headers: {'Content-Type': e.type, 'x-jd-pack': '1'}})
}

async function snapFetch(f) {
    const url = snapFile(f).href
    // a snapshot folder at a URL never changes (a new recording gets a new folder)
    return cachedFetch(SNAP_CACHE, url, () => fetch(url))
}

export function setSnapshot(v) {
    SNAP = v || ''
    snapIndex = null
    snapDate = null
    // a snapshot offers no sign-in; live GitHub may
    authConfigPromise = null
    // what was read is the other source's
    forgetLoaded()
    try {
        v ? localStorage.setItem(SNAP_KEY, v) : localStorage.removeItem(SNAP_KEY)
    } catch { window.name = v ? SNAP_NAME + v : '' }
}

function snapKey(url, method = 'GET') {
    const u = new URL(url, API)
    return (method === 'GET' ? '' : method + ' ') + u.pathname + u.search
}

let snapIndex
function loadSnapIndex() {
    snapIndex ??= snapFetch('index.json').then((r) => {
        if (!r.ok) throw new GitHubError(`Snapshot "${SNAP}" not found`, r.status)
        snapDate = r.headers.get('last-modified')
        return r.json()
    })
    return snapIndex
}

async function snapRequest(url, method) {
    const index = await loadSnapIndex()
    const e = index[snapKey(url, method)]
    if (!e) throw new GitHubError('Not in this snapshot (it has only what was recorded)', 404)
    const res = await snapFetch(e.file)
    if (!res.ok) throw new GitHubError(`Missing from snapshot "${SNAP}"`, 404)
    return new Response(await res.arrayBuffer(), {status: e.status, headers: {'Content-Type': e.type}})
}

/**
 * `live`: refuses the service worker's saved copy (what a commit is checked against must be current). `signal` aborts
 * the request.
 */
async function request(path, {accept = 'application/vnd.github+json', method = 'GET', body, live = false, signal} = {}) {
    const url = path.startsWith('http') ? path : API + path
    if (SNAP) {
        const res = await snapRequest(url, method)
        if (!res.ok) throw new GitHubError(`HTTP ${res.status}`, res.status)
        return res
    }
    const headers = {Accept: accept}
    let token = await currentToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'
    // GitHub allows a minute of caching: revalidated (a 304 costs no rate limit), else a ref or PR head can be stale
    const send = () => fetch(url, {method, headers, body: body && JSON.stringify(body), cache: 'no-cache', signal})
    // GitHub could not be reached: the imported packs answer what they hold (never what must be current)
    const fallback = () => live || signal?.aborted ? null : fromPack(url, method)
    let res
    try {
        res = await send()
    } catch (e) {
        if (!(e instanceof TypeError)) throw e
        res = await fallback()
        if (!res) throw e
    }
    if (res.status === 401 && signedIn() && !res.headers.get('x-jd-pack')) {
        token = await renewToken()
        if (token) headers.Authorization = `Bearer ${token}`
        else delete headers.Authorization
        res = await send()
    }
    // the service worker could not keep it (sw.js)
    if (res.headers.get('x-jd-unsaved')) storageFull()
    if (res.headers.get('x-jd-offline')) {
        window.dispatchEvent(new CustomEvent('jd-offline'))
        if (live) throw new GitHubError('No network: GitHub could not be reached', 503)
        // the service worker had no saved copy
        if (res.status === 503) res = await fallback() || res
    }
    if (!res.ok) {
        let message = res.statusText || `HTTP ${res.status}`
        try { message = (await res.json()).message || message } catch { /* not json */ }
        if (res.status === 404 && !token) message += '. If the repository is private, add a GitHub token.'
        // the primary limit gives its reset, a secondary one (searches made too fast) a wait
        let retryAt = 0
        const limited = (res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after'))
        if (limited) {
            message = 'GitHub API rate limit reached' + (token ? '' : '. Add a GitHub token for a higher limit.')
            retryAt = res.headers.get('retry-after') ? Date.now() + 1000 * +res.headers.get('retry-after') : 1000 * +res.headers.get('x-ratelimit-reset')
            if (!token && res.headers.get('x-ratelimit-remaining') === '0') window.dispatchEvent(new CustomEvent(RATE_LIMITED, {detail: {resetAt: retryAt}}))
        }
        if (res.status === 401) message = 'GitHub refused the token (401). Check or replace it.'
        const app = signedIn() && (res.status === 403 || res.status === 404) && (await authConfig())?.appSlug
        if (app) message += ` If jetdiff is not installed on this repository, install it: https://github.com/apps/${app}/installations/new`
        throw new GitHubError(message, res.status, retryAt)
    }
    return res
}

const json = async (path, opts) => (await request(path, opts)).json()

async function paginate(path, max = 30, opts) {
    const out = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; page <= max; page++) {
        const items = await json(`${path}${sep}per_page=100&page=${page}`, opts)
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

// GitHub's limits: a compare lists up to 300 files (on its first page only), a commit and a pull request up to 3000
const COMPARE_FILES = 300
const MAX_FILES = 3000

/** A target from a GitHub pull request, commit or compare URL, or from `o/r#12` or `o/r/12`; else null. */
export function parseTarget(input) {
    let s = (input || '').trim()
    if (/github\.com\//i.test(s)) s = s.replace(/[?#].*$/, '')
    const sha = '[0-9a-f]{7,40}'
    // a commit of the pull request, or (Files changed) a range of its commits
    let m = s.match(new RegExp(`github\\.com/([^/\\s]+)/([^/\\s]+)/pull/(\\d+)(?:/commits/(${sha})|/(?:files|changes)/(${sha}(?:\\.{2,3}${sha})?))?`, 'i'))
    if (m) return {type: 'pr', owner: m[1], repo: m[2], number: +m[3], commit: m[4] || m[5]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})/i)
    if (m) return {type: 'commit', owner: m[1], repo: m[2], sha: m[3]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/compare\/(.+?)(\.{2,3})(.+)$/i)
    if (m) return compareTarget(m[1], m[2], decodeURIComponent(m[3]), m[4], decodeURIComponent(m[5]))
    m = s.match(/^([\w.-]+)\/([\w.-]+)(?:#|\/pull\/|\/)(\d+)$/)
    if (m) return {type: 'pr', owner: m[1], repo: m[2], number: +m[3]}
    return null
}

export function targetToParams(t) {
    const p = new URLSearchParams()
    if (t.type === 'pr') {
        p.set('pr', `${t.owner}/${t.repo}/${t.number}`)
        if (t.commit) p.set('commit', t.commit)
    } else if (t.type === 'commit') p.set('commit', `${t.owner}/${t.repo}/${t.sha}`)
    else if (t.type === 'compare') p.set('compare', `${t.owner}/${t.repo}/${t.base}${compareDots(t)}${t.head}`)
    return p
}

/** A compare target; `dots` '..' compares the two tips directly, '...' (the default) from where head branched off base. */
function compareTarget(owner, repo, base, dots, head) {
    return {type: 'compare', owner, repo, base, head, ...(dots === '..' && {dots})}
}

export const compareDots = (t) => t.dots === '..' ? '..' : '...'

export function paramsToTarget(params) {
    const pr = params.get('pr')
    if (pr) {
        const [owner, repo, number] = pr.split('/')
        if (owner && repo && +number) return {type: 'pr', owner, repo, number: +number, commit: params.get('commit') || undefined}
    }
    const commit = params.get('commit')
    if (commit && commit.includes('/')) {
        const [owner, repo, sha] = commit.split('/')
        if (owner && repo && sha) return {type: 'commit', owner, repo, sha}
    }
    const compare = params.get('compare')
    if (compare) {
        const m = compare.match(/^([^/]+)\/([^/]+)\/(.+?)(\.{2,3})(.+)$/)
        if (m) return compareTarget(m[1], m[2], m[3], m[4], m[5])
    }
    return null
}

function mapFiles(files) {
    return files.map((f) => ({
        path: f.filename,
        prevPath: f.previous_filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        blobSha: f.sha,
    }))
}

/** The files that differ between the tips of a two-dot compare, from what changed since the merge base on each side. */
function directFiles(toHead, toBase) {
    const paths = (f) => [f.filename, f.previous_filename].filter(Boolean)
    const onHead = new Set(toHead.flatMap(paths)), onBase = new Set(toBase.flatMap(paths))
    const alone = (f, other) => !paths(f).some((p) => other.has(p))
    // changed on one side only: that side's change, the base's undone
    const out = mapFiles(toHead.filter((f) => alone(f, onBase)))
    const UNDO = {added: 'removed', removed: 'added', copied: 'removed'}
    for (const f of toBase.filter((f) => alone(f, onHead))) {
        const renamed = f.status === 'renamed' && f.previous_filename
        out.push({path: renamed ? f.previous_filename : f.filename, prevPath: renamed ? f.filename : undefined,
            status: UNDO[f.status] || f.status, additions: f.deletions, deletions: f.additions})
    }
    // a path both sides touched: compared by its blob at each tip
    const tips = (files) => {
        const t = new Map()
        for (const f of files) {
            if (f.status === 'renamed' && f.previous_filename) t.set(f.previous_filename, {blob: null, inMergeBase: true})
            t.set(f.filename, {blob: f.status === 'removed' ? null : f.sha, inMergeBase: !['added', 'copied', 'renamed'].includes(f.status)})
        }
        return t
    }
    const head = tips(toHead), base = tips(toBase)
    const both = new Set([...toHead.filter((f) => !alone(f, onBase)), ...toBase.filter((f) => !alone(f, onHead))].flatMap(paths))
    for (const p of both) {
        const h = head.get(p), b = base.get(p)
        // a side that did not touch the path has it as at the merge base
        const inMergeBase = (h || b).inMergeBase
        const inHead = h ? h.blob !== null : inMergeBase, inBase = b ? b.blob !== null : inMergeBase
        if ((!inHead && !inBase) || (h && b && h.blob === b.blob)) continue
        out.push({path: p, status: !inBase ? 'added' : !inHead ? 'removed' : 'modified', additions: null, deletions: null})
    }
    return out
}

const isSha = (s) => /^[0-9a-f]{40}$/i.test(s)

/**
 * `{title, owner, repo, baseSha, headSha, files, htmlUrl, pr?, commits?, commit?, range?, noMergeBase?, incomplete?}`.
 * A PR's base is the merge base, as in GitHub's "Files changed"; with `target.commit` (a sha or `a..b`), only those
 * commits of the PR. `noMergeBase`: the merge base could not be read, so the base is the base branch's tip.
 * `incomplete`: {shown, total?, limit}, GitHub listed only some of the files (it lists up to `limit`).
 */
export async function loadChangeSet(target, {signal} = {}) {
    const {owner, repo} = target
    const R = `/repos/${owner}/${repo}`
    const opts = {signal}
    // `reached`: the most GitHub listed in one answer
    const incomplete = (shown, total, limit, reached = shown) => (total ? total > shown : reached >= limit) ? {incomplete: {shown, total, limit}} : {}
    if (target.type === 'pr') {
        const [pr, commits] = await Promise.all([
            json(`${R}/pulls/${target.number}`, {accept: FULL, signal}),
            paginate(`${R}/pulls/${target.number}/commits`, 3, opts).catch((e) => { if (signal?.aborted) throw e; return [] }),
        ])
        const base = {
            owner, repo, pr, commits,
            title: pr.title,
            htmlUrl: pr.html_url,
        }
        if (target.commit?.includes('..')) {
            const [a, b] = target.commit.split(/\.{2,3}/)
            const first = commits.find((c) => c.sha.startsWith(a))
            const baseSha = first?.parents?.[0]?.sha || `${a}^`
            const cmp = await json(`${R}/compare/${baseSha}...${b}?per_page=100`, opts)
            // the range's head is `b`: the compare's first page holds its oldest commits only
            const headSha = [...commits, ...cmp.commits || []].find((c) => c.sha.startsWith(b))?.sha || b
            const files = cmp.files || []
            return {...base, baseSha, headSha, files: mapFiles(files), ...incomplete(files.length, 0, COMPARE_FILES),
                range: [a, b], htmlUrl: `${pr.html_url}/files/${baseSha}..${b}`}
        }
        if (target.commit) {
            const c = await loadCommit(owner, repo, target.commit, opts)
            return {...base, ...c, commit: c.commitInfo, htmlUrl: `${pr.html_url}/commits/${c.headSha}`}
        }
        const mergeBase = () => json(`${R}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`, opts)
        const [files, cmp] = await Promise.all([
            paginate(`${R}/pulls/${target.number}/files`, MAX_FILES / 100, opts),
            mergeBase().catch(() => signal?.aborted ? null : mergeBase()).catch(() => null),
        ])
        const mb = cmp?.merge_base_commit?.sha
        return {
            ...base,
            baseSha: mb || pr.base.sha,
            headSha: pr.head.sha,
            files: mapFiles(files),
            ...(!mb && {noMergeBase: true}),
            ...incomplete(files.length, pr.changed_files, MAX_FILES),
        }
    }
    if (target.type === 'commit') {
        const c = await loadCommit(owner, repo, target.sha, opts)
        return {owner, repo, ...c, commit: c.commitInfo, title: firstLine(c.commitInfo.message), htmlUrl: c.commitInfo.html_url}
    }
    if (target.type === 'compare') {
        const enc = encodeURIComponent
        // the API compares from the merge base only (three dots)
        const path = `${R}/compare/${enc(target.base)}...${enc(target.head)}`
        const cmp = await json(`${path}?per_page=100`, opts)
        // the commits come oldest first, 100 a page: up to 300 are read, as for a pull request
        const total = cmp.total_commits ?? cmp.commits?.length ?? 0
        const pages = Math.min(3, Math.ceil(total / 100))
        const direct = target.dots === '..' && !!cmp.base_commit && cmp.merge_base_commit?.sha !== cmp.base_commit.sha
        const [more, back] = await Promise.all([
            Promise.all(Array.from({length: Math.max(0, pages - 1)}, (_, i) => json(`${path}?per_page=100&page=${i + 2}`, opts))),
            // two dots, and the base has moved on since the head branched off: its own changes show too, undone
            direct ? json(`${R}/compare/${enc(target.head)}...${enc(target.base)}?per_page=1`, opts) : null,
        ])
        const commits = [cmp, ...more].flatMap((c) => c.commits || [])
        const headSha = commits.length >= total ? commits.at(-1)?.sha || target.head
            : isSha(target.head) ? target.head : (await json(`${R}/commits/${enc(target.head)}?per_page=1`, opts)).sha
        const toHead = cmp.files || [], toBase = back?.files || []
        const files = direct ? directFiles(toHead, toBase) : mapFiles(toHead)
        const url = (ref) => ref.split('/').map(encodeURIComponent).join('/')
        return {
            owner, repo, commits,
            title: `${target.base}${compareDots(target)}${target.head}`,
            htmlUrl: target.dots === '..' ? `https://github.com/${owner}/${repo}/compare/${url(target.base)}..${url(target.head)}` : cmp.html_url,
            baseSha: target.dots === '..' ? cmp.base_commit?.sha : cmp.merge_base_commit?.sha || cmp.base_commit?.sha,
            headSha,
            files,
            ...incomplete(files.length, 0, COMPARE_FILES, Math.max(toHead.length, toBase.length)),
        }
    }
    throw new Error('Unknown target')
}

const filesCache = new Map()
/** The changed files of one commit, or of the range from `first`'s parent to `last`. */
export function getCommitFiles(owner, repo, first, last, parentOfFirst) {
    return memo(filesCache, `${owner}/${repo}/${first}..${last}`, () => first === last
        ? loadCommit(owner, repo, first).then((c) => c.files)
        : json(`/repos/${owner}/${repo}/compare/${parentOfFirst || first + '^'}...${last}?per_page=100`).then((c) => mapFiles(c.files || [])))
}

async function loadCommit(owner, repo, sha, opts) {
    const path = `/repos/${owner}/${repo}/commits/${sha}`
    const first = await json(`${path}?per_page=100`, opts)
    // the files come 100 a page (per_page), up to GitHub's 3000
    let files = first.files || []
    for (let page = 2; files.length === (page - 1) * 100 && page <= MAX_FILES / 100; page++) {
        const more = (await json(`${path}?per_page=100&page=${page}`, opts)).files || []
        if (!more.length) break
        files = files.concat(more)
    }
    return {
        commitInfo: {sha: first.sha, message: first.commit.message, author: first.commit.author, html_url: first.html_url},
        baseSha: first.parents?.[0]?.sha || null,
        headSha: first.sha,
        files: mapFiles(files),
        ...(files.length >= MAX_FILES && {incomplete: {shown: files.length, limit: MAX_FILES}}),
    }
}

const contentCache = new Map()
const dirCache = new Map()

function looksBinary(bytes) {
    const n = Math.min(bytes.length, 8000)
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
    return false
}

/** Forgets what this tab keeps in memory of `owner/repo`'s files (of every repository without arguments). */
export function forgetLoaded(owner, repo) {
    const prefix = (s) => s.toLowerCase().startsWith(owner ? `${API}/repos/${owner}/${repo}/`.toLowerCase() : '')
    const files = (s) => s.toLowerCase().startsWith(owner ? `${owner}/${repo}/`.toLowerCase() : '')
    for (const k of contentCache.keys()) if (prefix(k)) contentCache.delete(k)
    for (const k of dirCache.keys()) if (prefix(k)) dirCache.delete(k)
    for (const k of filesCache.keys()) if (files(k)) filesCache.delete(k)
}

/** Why a text can not be written back as it was read, else null: Monaco evens out mixed line endings. */
const mixedLineEndings = (text) => text.includes('\r\n') && /(^|[^\r])\n/.test(text)

/**
 * The content of `path` at `ref`: `{text, size, readOnly?}` or `{binary: true, size, blob}`. `readOnly`: why an edit
 * could not keep the rest of the file as it is ('not UTF-8', 'mixed line endings').
 */
export function getFileContent(owner, repo, ref, path, {signal} = {}) {
    const url = `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
    return memo(contentCache, url, async () => {
        const load = () => request(url, {accept: 'application/vnd.github.raw+json', signal})
        // contents at a commit sha never change: kept for fast reopening (on a phone) and offline use; a snapshot's
        // are its own (another site's data never becomes GitHub's here)
        const res = /^[0-9a-f]{40}$/.test(ref) && !SNAP ? await cachedFetch(CONTENTS_CACHE, url, load) : await load()
        // a pack's answer is for while GitHub cannot be reached: read again next time
        if (res.headers.get('x-jd-pack')) setTimeout(() => contentCache.delete(url))
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (looksBinary(bytes)) return {binary: true, size: bytes.length, blob: new Blob([bytes])}
        // a BOM stays in the text (Monaco keeps it aside), so a commit writes it back
        let text, readOnly = null
        try {
            text = new TextDecoder('utf-8', {ignoreBOM: true, fatal: true}).decode(bytes)
        } catch {
            // shown with U+FFFD for what cannot be read; written back, those bytes would change
            text = new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
            readOnly = 'not UTF-8'
        }
        readOnly ??= mixedLineEndings(text) ? 'mixed line endings' : null
        return {text, size: bytes.length, ...readOnly && {readOnly}}
    })
}

/** The names of the files and folders in the folder `dir` ('' for the root) at `ref`: a Set. */
export function listDirectory(owner, repo, ref, dir) {
    const url = `${API}/repos/${owner}/${repo}/contents${dir ? '/' + dir.split('/').map(encodeURIComponent).join('/') : ''}?ref=${encodeURIComponent(ref)}`
    return memo(dirCache, url, async () => {
        const list = await json(url)
        return new Set(Array.isArray(list) ? list.map((e) => e.name) : [])
    })
}

/**
 * GitHub's code search for `text` in a repository (its default branch): [{path, fragments}], the fragments being the
 * text around the matches. It needs a token, and allows about 10 searches a minute.
 */
export async function searchCode(owner, repo, text, {signal} = {}) {
    const q = encodeURIComponent(`${text} repo:${owner}/${repo}`)
    const res = await json(`/search/code?q=${q}&per_page=30`, {accept: 'application/vnd.github.text-match+json', signal})
    return res.items.map((it) => ({path: it.path, fragments: (it.text_matches || []).map((m) => m.fragment)}))
}

export async function searchMyPullRequests() {
    const q = encodeURIComponent('is:pr is:open involves:@me archived:false')
    const res = await json(`/search/issues?q=${q}&sort=updated&order=desc&per_page=30`)
    return res.items.map((it) => {
        const [, owner, repo] = it.repository_url.match(/repos\/([^/]+)\/([^/]+)$/) || []
        return {owner, repo, number: it.number, title: it.title, updated: it.updated_at, user: it.user?.login, draft: it.draft}
    })
}

/** A repository's pull requests, from search (it has comment counts and drafts). state: open, closed, merged or all. */
export async function listPullRequests(owner, repo, {state = 'open', text = '', signal} = {}) {
    if (SNAP && text.trim()) {
        // a snapshot has the lists, not every search
        const words = text.toLowerCase().split(/\s+/).filter(Boolean)
        return (await listPullRequests(owner, repo, {state, signal})).filter((p) => words.every((w) => `${p.title} #${p.number} ${p.user}`.toLowerCase().includes(w)))
    }
    const parts = [`repo:${owner}/${repo}`, 'is:pr']
    if (state === 'open') parts.push('is:open')
    else if (state === 'closed') parts.push('is:closed', 'is:unmerged')
    else if (state === 'merged') parts.push('is:merged')
    if (text.trim()) parts.push(text.trim())
    const res = await json(`/search/issues?q=${encodeURIComponent(parts.join(' '))}&sort=created&order=desc&per_page=50`, {signal})
    return res.items.map((it) => ({
        number: it.number, title: it.title, user: it.user?.login, created: it.created_at, comments: it.comments,
        draft: it.draft, state: it.pull_request?.merged_at ? 'merged' : it.state,
    }))
}

export async function getViewer() {
    return json('/user')
}

/** {name, email} of the token's account; a private email is GitHub's noreply address, which still links to the profile. */
export async function accountIdentity() {
    const me = await getViewer()
    return {name: me.name || me.login, email: me.email || `${me.id}+${me.login}@users.noreply.github.com`}
}

async function graphql(query, variables) {
    const res = await request(`${API}/graphql`, {method: 'POST', body: {query, variables}})
    const data = await res.json()
    if (data.errors?.length) throw new GitHubError(data.errors.map((e) => e.message).join('; '), 200)
    if (!data.data) throw new GitHubError(data.message || 'GraphQL request failed', 200)
    return data.data
}

/** `{id, states}`: the PR's node id, and path -> 'VIEWED' | 'UNVIEWED' | 'DISMISSED'. Needs a token. */
export async function getViewedStates(owner, repo, number) {
    const states = new Map()
    let after = null
    let id
    for (let i = 0; i < 40; i++) {
        const d = await graphql(`query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){id files(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{path viewerViewedState}}}}}`,
            {o: owner, r: repo, n: number, after})
        const pr = d.repository.pullRequest
        id = pr.id
        for (const f of pr.files.nodes) states.set(f.path, f.viewerViewedState)
        if (!pr.files.pageInfo.hasNextPage) break
        after = pr.files.pageInfo.endCursor
    }
    return {id, states}
}

export async function setFileViewed(prNodeId, path, viewed) {
    const name = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
    await graphql(`mutation($id:ID!,$p:String!){${name}(input:{pullRequestId:$id,path:$p}){clientMutationId}}`, {id: prNodeId, p: path})
}

const refPath = (branch) => `heads/${branch.split('/').map(encodeURIComponent).join('/')}`

function canWrite() {
    if (SNAP) throw new GitHubError('This is a snapshot (recorded data): open the page without ?snap= and with a token to commit', 400)
    if (!getToken()) throw new GitHubError('Committing needs a GitHub token', 401)
}

const branchHead = async (owner, repo, branch) => (await json(`/repos/${owner}/${repo}/git/ref/${refPath(branch)}`, {live: true})).object.sha

// the edits were made on the files of `expected`: refused when the branch has moved since
async function leasedHead(owner, repo, branch, expected) {
    const head = await branchHead(owner, repo, branch)
    if (head !== expected)
        throw new GitHubError(`The branch has new commits (${head.slice(0, 7)}) since this page loaded: reload first`, 409)
    return head
}

async function updateRef(owner, repo, branch, sha, force) {
    try {
        await json(`/repos/${owner}/${repo}/git/refs/${refPath(branch)}`, {method: 'PATCH', body: {sha, force}})
    } catch (e) {
        // the update can land with its answer lost: then the branch is at `sha`
        if (!(e instanceof TypeError) && !(e.status >= 502)) throw e
        if (await branchHead(owner, repo, branch).catch(() => null) !== sha) throw e
    }
}

const dirOf = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/** The tree entries of `files` at `head`, read per directory (a recursive read of a big repository is truncated). */
async function headEntries(R, head, rootTree, files) {
    const dirs = [...new Set(files.map((f) => dirOf(f.path)))]
    const trees = new Map(await Promise.all(dirs.map(async (d) =>
        [d, (await json(`${R}/trees/${d ? encodeURIComponent(`${head}:${d}`) : rootTree}`)).tree])))
    return files.map((f) => {
        const name = f.path.slice(f.path.lastIndexOf('/') + 1)
        const e = trees.get(dirOf(f.path)).find((x) => x.path === name)
        // a submodule or a symlink would be replaced by a file
        if (!e || e.type !== 'blob' || !['100644', '100755'].includes(e.mode))
            throw new GitHubError(`${f.path} is ${e ? `not a regular file (mode ${e.mode})` : 'not in the branch'}: nothing was committed`, 422)
        return e
    })
}

/**
 * Commits `files` ([{path, text}]) on `branch` at `expectedHead`, or with `amend` replaces that commit. {sha, previous}.
 * An amend keeps the commit's author and date, as `git commit --amend` does; its committer is `committer`, else
 * `author`, else the token's account.
 */
export async function commitFiles({owner, repo, branch, expectedHead, files, message, amend = false, author = null, committer = null}) {
    canWrite()
    const R = `/repos/${owner}/${repo}/git`
    const head = await leasedHead(owner, repo, branch, expectedHead)
    const headCommit = await json(`${R}/commits/${head}`)
    let treeSha = headCommit.tree.sha
    if (files.length) {
        // each file keeps its mode: an executable script stays one
        const entries = await headEntries(R, head, treeSha, files)
        treeSha = (await json(`${R}/trees`, {method: 'POST', body: {
            base_tree: treeSha,
            tree: files.map((f, i) => ({path: f.path, mode: entries[i].mode, type: 'blob', content: f.text})),
        }})).sha
    }
    // without an author or committer GitHub uses the token's account; with an author only, the author is the committer
    // too: an amend names its committer, or the original author would be
    const body = amend
        ? {message, tree: treeSha, parents: headCommit.parents.map((p) => p.sha), author: headCommit.author, committer: committer || author || await accountIdentity()}
        : {message, tree: treeSha, parents: [head], ...(author && {author}), ...(committer && {committer})}
    const commit = await json(`${R}/commits`, {method: 'POST', body})
    // a forced update cannot be made conditional here (issues/open/atomic-force-updates.md): checked again just before
    if (amend) await leasedHead(owner, repo, branch, head)
    await updateRef(owner, repo, branch, commit.sha, amend)
    return {sha: commit.sha, previous: head}
}

/** Moves `branch` back to `sha` (undoes a commit made here), if it is still at `expected`. */
export async function moveBranch({owner, repo, branch, sha, expected}) {
    canWrite()
    await leasedHead(owner, repo, branch, expected)
    await updateRef(owner, repo, branch, sha, true)
}

export async function getPullHead(owner, repo, number) {
    return (await json(`/repos/${owner}/${repo}/pulls/${number}`, {live: true})).head.sha
}

/** A commit's message, author and tree, from the Git data API. */
export async function getGitCommit(owner, repo, sha) {
    return json(`/repos/${owner}/${repo}/git/commits/${sha}`)
}

/**
 * `{comments, reviews, inline, reactions}` of a PR, bodies with GitHub's HTML; `reactions` are the description's (the
 * pull request answer has none, its issue has), null where they could not be read.
 */
export async function getTimeline(owner, repo, number, {signal} = {}) {
    const R = `/repos/${owner}/${repo}`
    const list = (path) => paginate(`${R}/${path}`, 5, {accept: FULL, signal})
    const [comments, reviews, inline, issue] = await Promise.all([
        list(`issues/${number}/comments`),
        list(`pulls/${number}/reviews`),
        list(`pulls/${number}/comments`).catch(() => []),
        json(`${R}/issues/${number}`, {signal}).catch(() => null),
    ])
    return {comments, reviews, inline, reactions: issue?.reactions || null}
}

/** All open pull requests ({number, title}), from the REST list, which has no search limit. */
export async function listOpenPulls(owner, repo, {signal} = {}) {
    return (await paginate(`/repos/${owner}/${repo}/pulls?state=open`, 10, {signal})).map((p) => ({number: p.number, title: p.title}))
}

/** The repositories a snapshot holds ([{owner, repo, prs}]) when it was recorded with --repos, else null. */
export async function snapshotRepos() {
    if (!SNAP) return null
    try {
        const r = await snapFetch('repos.json')
        return r.ok ? await r.json() : null
    } catch { return null }
}
