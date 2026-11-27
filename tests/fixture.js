import fs from 'node:fs'
import {test as base, expect} from '@playwright/test'

const dir = new URL('./fixture/', import.meta.url)
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir)))
const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*'}

export const PR = 'repalash/threepipe/193'
export const HEAD = 'c2df7d7a26f86dd3cad9cd13603aa9ad99fde215'
export const FIXTURE_DIR = dir

/** A recorded response, parsed. */
export const recorded = (path) => JSON.parse(fs.readFileSync(new URL(index[path].file, dir)))

/**
 * `github`: api.github.com answered from tests/fixture (threepipe PR 193, recorded with tools/record-snapshot.cjs).
 * Writes are recorded in `github.writes` and answered by `github.handle(fn)` handlers ({raw} for a file's bytes, {status,
 * headers, body} for an error), else refused. `github.alias`
 * {sha: fixture sha}: a commit made in a test reads as the fixture's.
 * `token`: a GitHub token in the page's storage, so edits and commits are offered.
 */
export const test = base.extend({
    token: [false, {option: true}],
    github: async ({context, token}, use) => {
        const github = {writes: [], handlers: [], alias: {}, handle(fn) { this.handlers.push(fn) }}
        if (token) await context.addInitScript(() => localStorage.setItem('jd.token', 'test-token'))
        await context.route('https://api.github.com/**', async (route) => {
            const req = route.request()
            const url = new URL(req.url())
            const json = (body, status = 200) => route.fulfill({status, headers: {...cors, 'content-type': 'application/json'}, body: JSON.stringify(body)})
            if (req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: cors})
            if (req.method() !== 'GET' || url.pathname.startsWith('/repos/repalash/threepipe/git/') || url.pathname === '/graphql') {
                const write = {method: req.method(), path: url.pathname, body: req.postDataJSON?.() ?? null}
                github.writes.push(write)
                for (const h of github.handlers) {
                    const out = h(write)
                    if (out) return json(out)
                }
                return url.pathname === '/graphql' ? json({data: null}) : json({message: 'Not mocked'}, 501)
            }
            for (const h of github.handlers) {
                const out = h({method: 'GET', path: url.pathname + url.search, headers: req.headers()})
                if (out?.raw !== undefined) return route.fulfill({status: 200, headers: {...cors, 'content-type': 'application/octet-stream'}, body: out.raw})
                if (out?.status) return route.fulfill({status: out.status, headers: {...cors, 'content-type': 'application/json', ...out.headers}, body: JSON.stringify(out.body ?? {})})
                if (out) return json(out)
            }
            const key = Object.entries(github.alias).reduce((k, [from, to]) => k.replaceAll(from, to), url.pathname + url.search)
            const hit = index[key]
            if (!hit) return json({message: 'Not in the fixture'}, 404)
            route.fulfill({status: hit.status, headers: {...cors, 'content-type': hit.type}, body: fs.readFileSync(new URL(hit.file, dir))})
        })
        await use(github)
    },
    page: async ({page, github}, use) => {
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.github = github
        await use(page)
        expect(errors.filter((m) => !/Canceled/.test(m))).toEqual([])
    },
})

/** A made-up 40-character sha whose first 8 characters are `n` in hex. */
export const fakeSha = (n) => n.toString(16).padStart(8, '0').padEnd(40, 'e')
const segments = (path) => path.split('/').map(encodeURIComponent).join('/')

/** The page of `list` that a request's `per_page` and `page` ask for, as GitHub gives it. */
export function pageOf(path, list) {
    const q = new URLSearchParams(path.split('?')[1])
    const size = +q.get('per_page') || 30, n = +q.get('page') || 1
    return list.slice((n - 1) * size, n * size)
}

/**
 * A made-up pull request `number` of repalash/threepipe, answered by `github.handle`. `files`: [{filename, status?,
 * previous_filename?, old?, new?}], `old` and `new` the text at the base and at the head. `pr` overrides the PR's fields.
 * Returns {base, head, url}.
 */
export function fakePr(github, number, files, pr = {}) {
    const R = '/repos/repalash/threepipe'
    const base = fakeSha(0xba5e), head = fakeSha(0xbead)
    const tpl = recorded(`${R}/pulls/193`)
    // as GitHub lists them (a test may change `files` meanwhile)
    const listed = () => files.map((f) => ({status: 'modified', additions: 1, deletions: 1, sha: fakeSha(1), ...f, old: undefined, new: undefined}))
    github.handle(({method, path}) => {
        if (method !== 'GET') return
        if (path === `${R}/pulls/${number}`) return {...tpl, number, title: 'A made-up pull request', state: 'open', changed_files: files.length,
            head: {...tpl.head, sha: head}, base: {...tpl.base, sha: base}, ...pr}
        const commit = {sha: head, parents: [{sha: base}], author: null, html_url: `https://github.com${R}/commit/${head}`,
            commit: {message: 'Change', author: {name: 'A', date: '2026-01-01T00:00:00Z'}, committer: {name: 'A', date: '2026-01-01T00:00:00Z'}}}
        if (path.startsWith(`${R}/pulls/${number}/commits?`)) return [commit]
        if (path.startsWith(`${R}/commits/${head}?`)) return {...commit, files: pageOf(path, listed())}
        if (path.startsWith(`${R}/pulls/${number}/files?`)) return pageOf(path, listed())
        if (path === `${R}/compare/${base}...${head}?per_page=1`) return {merge_base_commit: {sha: base}, base_commit: {sha: base}}
        for (const f of files) {
            if (path === `${R}/contents/${segments(f.previous_filename || f.filename)}?ref=${base}`) return {raw: f.old ?? ''}
            if (path === `${R}/contents/${segments(f.filename)}?ref=${head}`) return {raw: f.new ?? ''}
        }
    })
    return {base, head, url: `./?pr=repalash/threepipe/${number}`}
}

/** Waits until the change set is loaded and a file's diff is shown. */
export async function ready(page) {
    await expect(page.locator('#diff-count')).not.toBeEmpty({timeout: 30000})
    await expect(page.locator('#loading-bar')).not.toHaveClass(/\bon\b/)
}

export {expect}
