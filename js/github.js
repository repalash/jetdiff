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

export function signIn() {
    location.assign(`${new URL('login', AUTH)}?return=${encodeURIComponent(location.pathname + location.search)}`)
}

export async function signOut() {
    setToken('')
    await fetch(new URL('logout', AUTH), {method: 'POST'}).catch(() => {})
}

/** Takes the token Sign in with GitHub left in the URL fragment; true if there was one. */
export function takeSignInToken() {
    const params = new URLSearchParams(location.hash.slice(1))
    const token = params.get('jd-auth')
    if (!token) return false
    setToken(token, +params.get('expires_in') || 0)
    history.replaceState(history.state, '', location.pathname + location.search)
    return true
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
    constructor(message, status) {
        super(message)
        this.status = status
    }
}

/** A Cache Storage cache, or null: a sandboxed page has none. */
async function openCache(name) {
    try { return await caches.open(name) } catch { return null }
}

/** `load()`'s response for `url`, kept in the cache `name` (only for what never changes). */
async function cachedFetch(name, url, load) {
    const cache = await openCache(name)
    const hit = await cache?.match(url).catch(() => null)
    if (hit) return hit
    const res = await load()
    if (cache && res.ok) res.clone().arrayBuffer()
        .then((buf) => cache.put(url, new Response(buf, {headers: {'Content-Type': 'application/octet-stream'}})))
        .catch(() => {})
    return res
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

// `?snap=` is a name (snap/<name>/ next to the page), an https URL of a snapshot folder, or `pack` (imported offline
// packs). Kept in localStorage, as an installed app starts at ./ with no ?snap=; where a sandboxed page has no
// storage, in window.name, which lasts while the tab navigates.
let SNAP = (() => {
    const s = new URLSearchParams(location.search).get('snap')
    try {
        if (s !== null) s ? localStorage.setItem(SNAP_KEY, s) : localStorage.removeItem(SNAP_KEY)
        const v = localStorage.getItem(SNAP_KEY) || ''
        if (v) return v
    } catch { /* no storage */ }
    if (s !== null) window.name = s ? SNAP_NAME + s : ''
    return s || (window.name.startsWith(SNAP_NAME) ? window.name.slice(SNAP_NAME.length) : '')
})()
const remoteSnap = () => /^https:\/\//.test(SNAP)
const snapFile = (f) => remoteSnap()
    ? new URL(f, SNAP.endsWith('/') ? SNAP : SNAP + '/')
    : new URL(`../snap/${encodeURIComponent(SNAP)}/${f}`, import.meta.url)
export const snapshotName = () => SNAP

export const packUrl = (f) => `https://pack.jd/${f}`
/** Packs held in memory where the page has no Cache Storage: file -> bytes. */
export const packMemory = new Map()

async function snapFetch(f) {
    if (SNAP === 'pack') {
        if (packMemory.has(f)) return new Response(packMemory.get(f))
        return await (await openCache(PACK_CACHE))?.match(packUrl(f)).catch(() => null) || new Response('', {status: 404})
    }
    const url = snapFile(f).href
    // a snapshot folder never changes (a new recording gets a new folder)
    return remoteSnap() ? cachedFetch(SNAP_CACHE, url, () => fetch(url)) : fetch(url)
}

export function setSnapshot(v) {
    SNAP = v || ''
    snapIndex = null
    try {
        v ? localStorage.setItem(SNAP_KEY, v) : localStorage.removeItem(SNAP_KEY)
    } catch { window.name = v ? SNAP_NAME + v : '' }
}

function snapKey(url, method = 'GET') {
    const u = new URL(url, API)
    return (method === 'GET' ? '' : method + ' ') + u.pathname + u.search
}

let snapIndex
async function snapRequest(url, method) {
    snapIndex ??= snapFetch('index.json').then((r) => {
        if (!r.ok) throw new GitHubError(`Snapshot "${SNAP}" not found`, r.status)
        return r.json()
    })
    const index = await snapIndex
    const e = index[snapKey(url, method)]
    if (!e) throw new GitHubError('Not in this snapshot (it has only what was recorded)', 404)
    const res = await snapFetch(e.file)
    return new Response(await res.arrayBuffer(), {status: e.status, headers: {'Content-Type': e.type}})
}

async function request(path, {accept = 'application/vnd.github+json', method = 'GET', body} = {}) {
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
    const send = () => fetch(url, {method, headers, body: body && JSON.stringify(body)})
    let res = await send()
    if (res.status === 401 && signedIn()) {
        token = await renewToken()
        if (token) headers.Authorization = `Bearer ${token}`
        else delete headers.Authorization
        res = await send()
    }
    if (res.headers.get('x-jd-offline')) window.dispatchEvent(new CustomEvent('jd-offline'))
    if (!res.ok) {
        let message = res.statusText || `HTTP ${res.status}`
        try { message = (await res.json()).message || message } catch { /* not json */ }
        if (res.status === 404 && !token) message += '. If the repository is private, add a GitHub token.'
        if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0')
            message = 'GitHub API rate limit reached' + (token ? '' : '. Add a GitHub token for a higher limit.')
        if (res.status === 401) message = 'GitHub refused the token (401). Check or replace it.'
        const app = signedIn() && (res.status === 403 || res.status === 404) && (await authConfig())?.appSlug
        if (app) message += ` If jetdiff is not installed on this repository, install it: https://github.com/apps/${app}/installations/new`
        throw new GitHubError(message, res.status)
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

// commit and compare responses list up to 300 files a page
async function allFiles(path, first) {
    let files = first.files || []
    for (let page = 2; files.length === (page - 1) * 300 && page < 12; page++) {
        const more = await json(`${path}?per_page=100&page=${page}`)
        if (!more.files?.length) break
        files = files.concat(more.files)
    }
    return files
}

/** A target from a GitHub pull request, commit or compare URL, or from `o/r#12` or `o/r/12`; else null. */
export function parseTarget(input) {
    let s = (input || '').trim()
    if (/github\.com\//i.test(s)) s = s.replace(/[?#].*$/, '')
    let m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:\/commits\/([0-9a-f]{7,40}))?/i)
    if (m) return {type: 'pr', owner: m[1], repo: m[2], number: +m[3], commit: m[4]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})/i)
    if (m) return {type: 'commit', owner: m[1], repo: m[2], sha: m[3]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/compare\/(.+?)(\.{2,3})(.+)$/i)
    if (m) return {type: 'compare', owner: m[1], repo: m[2], base: decodeURIComponent(m[3]), head: decodeURIComponent(m[5])}
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
    else if (t.type === 'compare') p.set('compare', `${t.owner}/${t.repo}/${t.base}...${t.head}`)
    return p
}

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
        const m = compare.match(/^([^/]+)\/([^/]+)\/(.+?)\.{2,3}(.+)$/)
        if (m) return {type: 'compare', owner: m[1], repo: m[2], base: m[3], head: m[4]}
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

/**
 * `{title, owner, repo, baseSha, headSha, files, htmlUrl, pr?, commits?, commit?, range?}`. A PR's base is the merge
 * base, as in GitHub's "Files changed"; with `target.commit` (a sha or `a..b`), only those commits of the PR.
 */
export async function loadChangeSet(target) {
    const {owner, repo} = target
    const R = `/repos/${owner}/${repo}`
    if (target.type === 'pr') {
        const [pr, commits] = await Promise.all([
            json(`${R}/pulls/${target.number}`, {accept: FULL}),
            paginate(`${R}/pulls/${target.number}/commits`, 3).catch(() => []),
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
            const cmp = await json(`${R}/compare/${baseSha}...${b}?per_page=100`)
            return {...base, baseSha, headSha: cmp.commits?.at(-1)?.sha || b, files: mapFiles(cmp.files || []),
                range: [a, b], htmlUrl: `${pr.html_url}/files/${baseSha}..${b}`}
        }
        if (target.commit) {
            const c = await loadCommit(owner, repo, target.commit)
            return {...base, ...c, commit: c.commitInfo, htmlUrl: `${pr.html_url}/commits/${c.headSha}`}
        }
        const [files, cmp] = await Promise.all([
            paginate(`${R}/pulls/${target.number}/files`),
            json(`${R}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`).catch(() => null),
        ])
        return {
            ...base,
            baseSha: cmp?.merge_base_commit?.sha || pr.base.sha,
            headSha: pr.head.sha,
            files: mapFiles(files),
        }
    }
    if (target.type === 'commit') {
        const c = await loadCommit(owner, repo, target.sha)
        return {owner, repo, ...c, commit: c.commitInfo, title: firstLine(c.commitInfo.message), htmlUrl: c.commitInfo.html_url}
    }
    if (target.type === 'compare') {
        const path = `${R}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}`
        const cmp = await json(`${path}?per_page=100`)
        const commits = cmp.commits || []
        return {
            owner, repo, commits,
            title: `${target.base}...${target.head}`,
            htmlUrl: cmp.html_url,
            baseSha: cmp.merge_base_commit?.sha || cmp.base_commit?.sha,
            headSha: commits.at(-1)?.sha || target.head,
            files: mapFiles(await allFiles(path, cmp)),
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

async function loadCommit(owner, repo, sha) {
    const path = `/repos/${owner}/${repo}/commits/${sha}`
    const first = await json(`${path}?per_page=100`)
    return {
        commitInfo: {sha: first.sha, message: first.commit.message, author: first.commit.author, html_url: first.html_url},
        baseSha: first.parents?.[0]?.sha || null,
        headSha: first.sha,
        files: mapFiles(await allFiles(path, first)),
    }
}

const contentCache = new Map()

function looksBinary(bytes) {
    const n = Math.min(bytes.length, 8000)
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
    return false
}

/** The content of `path` at `ref`: `{text, size}` or `{binary: true, size, blob}`. */
export function getFileContent(owner, repo, ref, path) {
    const url = `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
    return memo(contentCache, url, async () => {
        const load = () => request(url, {accept: 'application/vnd.github.raw+json'})
        // contents at a commit sha never change: kept for fast reopening (on a phone) and offline use
        const res = /^[0-9a-f]{40}$/.test(ref) ? await cachedFetch(CONTENTS_CACHE, url, load) : await load()
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (looksBinary(bytes)) return {binary: true, size: bytes.length, blob: new Blob([bytes])}
        return {text: new TextDecoder('utf-8').decode(bytes), size: bytes.length}
    })
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
export async function listPullRequests(owner, repo, {state = 'open', text = ''} = {}) {
    if (SNAP && text.trim()) {
        // a snapshot has the lists, not every search
        const words = text.toLowerCase().split(/\s+/).filter(Boolean)
        return (await listPullRequests(owner, repo, {state})).filter((p) => words.every((w) => `${p.title} #${p.number} ${p.user}`.toLowerCase().includes(w)))
    }
    const parts = [`repo:${owner}/${repo}`, 'is:pr']
    if (state === 'open') parts.push('is:open')
    else if (state === 'closed') parts.push('is:closed', 'is:unmerged')
    else if (state === 'merged') parts.push('is:merged')
    if (text.trim()) parts.push(text.trim())
    const res = await json(`/search/issues?q=${encodeURIComponent(parts.join(' '))}&sort=created&order=desc&per_page=50`)
    return res.items.map((it) => ({
        number: it.number, title: it.title, user: it.user?.login, created: it.created_at, comments: it.comments,
        draft: it.draft, state: it.pull_request?.merged_at ? 'merged' : it.state,
    }))
}

export async function getViewer() {
    return json('/user')
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

// the edits were made on the files of `expected`: refused when the branch has moved since
async function leasedHead(owner, repo, branch, expected) {
    const head = (await json(`/repos/${owner}/${repo}/git/ref/${refPath(branch)}`)).object.sha
    if (head !== expected)
        throw new GitHubError(`The branch has new commits (${head.slice(0, 7)}) since this page loaded: reload first`, 409)
    return head
}

/** Commits `files` ([{path, text}]) on `branch` at `expectedHead`, or with `amend` replaces that commit. {sha, previous}. */
export async function commitFiles({owner, repo, branch, expectedHead, files, message, amend = false, author = null, committer = null}) {
    canWrite()
    const R = `/repos/${owner}/${repo}/git`
    const head = await leasedHead(owner, repo, branch, expectedHead)
    const headCommit = await json(`${R}/commits/${head}`)
    let treeSha = headCommit.tree.sha
    if (files.length) {
        // keep each file's mode (an executable script stays one)
        const modes = new Map()
        try {
            const t = await json(`${R}/trees/${treeSha}?recursive=1`)
            for (const e of t.tree) if (e.type === 'blob') modes.set(e.path, e.mode)
        } catch { /* default mode */ }
        treeSha = (await json(`${R}/trees`, {method: 'POST', body: {
            base_tree: treeSha,
            tree: files.map((f) => ({path: f.path, mode: modes.get(f.path) || '100644', type: 'blob', content: f.text})),
        }})).sha
    }
    // without an author or committer GitHub uses the token's account; an amend keeps the commit's author
    const body = amend
        ? {message, tree: treeSha, parents: headCommit.parents.map((p) => p.sha), author: author || headCommit.author}
        : {message, tree: treeSha, parents: [head], ...(author && {author})}
    if (committer) body.committer = committer
    const commit = await json(`${R}/commits`, {method: 'POST', body})
    await json(`${R}/refs/${refPath(branch)}`, {method: 'PATCH', body: {sha: commit.sha, force: amend}})
    return {sha: commit.sha, previous: head}
}

/** Moves `branch` back to `sha` (undoes a commit made here), if it is still at `expected`. */
export async function moveBranch({owner, repo, branch, sha, expected}) {
    canWrite()
    await leasedHead(owner, repo, branch, expected)
    await json(`/repos/${owner}/${repo}/git/refs/${refPath(branch)}`, {method: 'PATCH', body: {sha, force: true}})
}

export async function getPullHead(owner, repo, number) {
    return (await json(`/repos/${owner}/${repo}/pulls/${number}`)).head.sha
}

/** `{comments, reviews, inline}` of a PR, bodies with GitHub's HTML. */
export async function getTimeline(owner, repo, number) {
    const R = `/repos/${owner}/${repo}`
    const list = (path) => paginate(`${R}/${path}`, 5, {accept: FULL})
    const [comments, reviews, inline] = await Promise.all([
        list(`issues/${number}/comments`),
        list(`pulls/${number}/reviews`),
        list(`pulls/${number}/comments`).catch(() => []),
    ])
    return {comments, reviews, inline}
}

/** All open pull requests ({number, title}), from the REST list, which has no search limit. */
export async function listOpenPulls(owner, repo) {
    return (await paginate(`/repos/${owner}/${repo}/pulls?state=open`, 10)).map((p) => ({number: p.number, title: p.title}))
}

/** The repositories a snapshot holds ([{owner, repo, prs}]) when it was recorded with --repos, else null. */
export async function snapshotRepos() {
    if (!SNAP) return null
    try {
        const r = await snapFetch('repos.json')
        return r.ok ? await r.json() : null
    } catch { return null }
}
