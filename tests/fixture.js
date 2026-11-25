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
 * Writes are recorded in `github.writes` and answered by `github.handle(fn)` handlers ({raw} for a file's bytes), else refused. `github.alias`
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

/** Waits until the change set is loaded and a file's diff is shown. */
export async function ready(page) {
    await expect(page.locator('#diff-count')).not.toBeEmpty({timeout: 30000})
    await expect(page.locator('#loading-bar')).not.toHaveClass(/\bon\b/)
}

export {expect}
