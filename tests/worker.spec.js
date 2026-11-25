import {test, expect} from '@playwright/test'
import worker from '../worker/index.js'

const env = {ASSETS: {fetch: async () => new Response('asset')}, GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret', GITHUB_APP_SLUG: 'jetdiff'}
const get = (path, init = {}, e = env) => worker.fetch(new Request('https://jetdiff.com' + path, init), e)

/** Answers GitHub's token endpoint with `tokens`, recording what was sent. */
function mockGitHub(tokens) {
    const sent = []
    const real = globalThis.fetch
    globalThis.fetch = async (url, init) => {
        expect(String(url)).toBe('https://github.com/login/oauth/access_token')
        sent.push(JSON.parse(init.body))
        return Response.json(tokens)
    }
    return {sent, restore: () => { globalThis.fetch = real }}
}

test('www redirects to the bare domain, and assets get the security headers', async () => {
    const www = await worker.fetch(new Request('https://www.jetdiff.com/x?pr=a/b/1'), env)
    expect(www.status).toBe(301)
    expect(www.headers.get('location')).toBe('https://jetdiff.com/x?pr=a/b/1')
    const page = await get('/')
    expect(await page.text()).toBe('asset')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
})

test('sign-in is off until the app is set up', async () => {
    expect((await get('/auth/config', {}, {ASSETS: env.ASSETS})).status).toBe(404)
    expect(await (await get('/auth/config')).json()).toEqual({clientId: 'cid', appSlug: 'jetdiff'})
})

test('sign-in: login, callback with the state, refresh from the cookie, logout', async () => {
    const login = await get('/auth/login?return=' + encodeURIComponent('/?pr=a/b/1'))
    expect(login.status).toBe(302)
    const to = new URL(login.headers.get('location'))
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('cid')
    expect(to.searchParams.get('redirect_uri')).toBe('https://jetdiff.com/auth/callback')
    const state = to.searchParams.get('state')
    const stateCookie = login.headers.get('set-cookie').split(';')[0]
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')

    expect((await get(`/auth/callback?code=c&state=other`, {headers: {cookie: stateCookie}})).status).toBe(400)

    const gh = mockGitHub({access_token: 'tok', expires_in: 28800, refresh_token: 'rt', refresh_token_expires_in: 100})
    try {
        const back = await get(`/auth/callback?code=c&state=${state}`, {headers: {cookie: stateCookie}})
        expect(back.status).toBe(302)
        expect(back.headers.get('location')).toBe('/?pr=a/b/1#jd-auth=tok&expires_in=28800')
        expect(gh.sent).toEqual([{client_id: 'cid', client_secret: 'secret', code: 'c', redirect_uri: 'https://jetdiff.com/auth/callback'}])
        expect(back.headers.get('set-cookie')).toMatch(/jd_refresh=rt; Path=\/auth; Max-Age=100; HttpOnly; Secure; SameSite=Lax/)
    } finally { gh.restore() }

    expect((await get('/auth/refresh', {method: 'POST'})).status).toBe(401)
    const gh2 = mockGitHub({access_token: 'tok2', expires_in: 28800, refresh_token: 'rt2'})
    try {
        const refreshed = await get('/auth/refresh', {method: 'POST', headers: {cookie: 'jd_refresh=rt'}})
        expect(await refreshed.json()).toEqual({access_token: 'tok2', expires_in: 28800})
        expect(gh2.sent[0]).toMatchObject({grant_type: 'refresh_token', refresh_token: 'rt'})
        expect(refreshed.headers.get('set-cookie')).toContain('jd_refresh=rt2')
    } finally { gh2.restore() }

    const out = await get('/auth/logout', {method: 'POST'})
    expect(out.headers.get('set-cookie')).toContain('jd_refresh=; Path=/auth; Max-Age=0')
})

test('sign-in only returns to a path on this site', async () => {
    for (const bad of ['//evil.example/x', 'https://evil.example', '/\\evil.example', '/\t/evil.example/', '/\t\\evil.example', '/\n/evil.example', 'https://jetdiff.com//evil.example', 'javascript:alert(1)']) {
        const login = await get('/auth/login?return=' + encodeURIComponent(bad))
        expect(decodeURIComponent(login.headers.get('set-cookie'))).toMatch(/jd_auth_state=[^|]+\|\/;/)
    }
    const ok = await get('/auth/login?return=' + encodeURIComponent('/?pr=a/b/1&file=x'))
    expect(decodeURIComponent(ok.headers.get('set-cookie'))).toContain('|/?pr=a/b/1&file=x;')
})

test('request logs carry the path only: no query, no repository names', async () => {
    const lines = []
    const real = console.log
    console.log = (line) => lines.push(JSON.parse(line))
    try {
        await get('/?pr=org/private-repo/12&file=src/secret.ts')
        await worker.fetch(new Request('https://jetdiff.com/org/private-repo/pull/12'), {...env, ASSETS: {fetch: async () => new Response('404 page', {status: 404})}})
        await get('/auth/callback?code=c&state=s')
    } finally { console.log = real }
    expect(lines.map((l) => l.path)).toEqual(['/', '/(github link)', '/auth/callback'])
    expect(JSON.stringify(lines)).not.toMatch(/private-repo|secret|code=/)
})
