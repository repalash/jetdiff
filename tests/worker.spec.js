import {test, expect} from '@playwright/test'
import worker from '../worker/index.js'
import {CONTENT_SECURITY_POLICY, headersFile} from '../worker/headers.js'
import fs from 'node:fs'

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

test('pages get the Content Security Policy, also when revalidated, and other files do not need it', async () => {
    const typed = (type, status = 200) => ({...env, ASSETS: {fetch: async () => new Response(status === 304 ? null : 'x', {status, headers: type ? {'content-type': type} : {}})}})
    const page = await worker.fetch(new Request('https://jetdiff.com/?pr=a/b/1'), typed('text/html; charset=utf-8'))
    expect(page.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'sha256-")
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    const revalidated = await worker.fetch(new Request('https://jetdiff.com/', {headers: {'sec-fetch-dest': 'document'}}), typed(null, 304))
    expect(revalidated.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    const script = await worker.fetch(new Request('https://jetdiff.com/js/main.js'), typed('text/javascript'))
    expect(script.headers.get('content-security-policy')).toBeNull()
    expect(script.headers.get('x-content-type-options')).toBe('nosniff')
})

test('the libraries skip the Worker and get the same headers from dist/_headers', async () => {
    const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    expect(config.assets.run_worker_first).toEqual(['/*', '!/vendor/*'])
    const file = headersFile()
    expect(file.split('\n')[0]).toBe('/vendor/*')
    expect(file).toContain('  x-content-type-options: nosniff\n')
    expect(file).toContain(`  content-security-policy: ${CONTENT_SECURITY_POLICY}\n`)
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

    const out = await get('/auth/logout', {method: 'POST', headers: {origin: 'https://jetdiff.com'}})
    expect(out.headers.get('set-cookie')).toContain('jd_refresh=; Path=/auth; Max-Age=0')
})

test('logout revokes the token at GitHub, for the page itself only, whatever GitHub answers', async () => {
    const sent = []
    let answer = () => new Response(null, {status: 204})
    const real = globalThis.fetch
    globalThis.fetch = async (url, init) => {
        sent.push({url: String(url), method: init.method, authorization: init.headers.authorization, body: JSON.parse(init.body)})
        return answer()
    }
    const logout = (origin) => get('/auth/logout', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({token: 'tok'})})
    try {
        expect((await logout('https://evil.example')).status).toBe(403)
        expect(sent).toEqual([])
        const out = await logout('https://jetdiff.com')
        expect(out.status).toBe(204)
        expect(out.headers.get('set-cookie')).toContain('jd_refresh=; Path=/auth; Max-Age=0')
        expect(sent).toEqual([{url: 'https://api.github.com/applications/cid/token', method: 'DELETE', authorization: `Basic ${btoa('cid:secret')}`, body: {access_token: 'tok'}}])
        answer = () => new Response('{"message": "Not Found"}', {status: 404})
        expect((await logout('https://jetdiff.com')).status).toBe(204)
        answer = () => { throw new TypeError('fetch failed') }
        expect((await logout('https://jetdiff.com')).status).toBe(204)
    } finally { globalThis.fetch = real }
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
