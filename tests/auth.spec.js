import {test, expect, ready, PR, fakePr} from './fixture.js'

const authHeaders = (github) => {
    const seen = new Set()
    github.handle(({headers}) => { if (headers?.authorization) seen.add(headers.authorization) })
    return seen
}

test('Sign in with GitHub keeps the token it brings back, and the API gets it', async ({page, context}) => {
    const seen = authHeaders(page.github)
    await context.route('**/auth/config', (r) => r.fulfill({json: {clientId: 'cid', appSlug: 'jetdiff'}}))
    await context.route('**/auth/login?*', (r) => {
        expect(new URL(r.request().url()).searchParams.get('return')).toBe('/')
        r.fulfill({status: 302, headers: {location: `/?pr=${PR}#jd-auth=tok1&expires_in=28800`}})
    })
    await page.goto('./')
    await page.locator('#land-signin').click()
    await ready(page)
    expect(new URL(page.url()).hash).toBe('')
    expect(await page.evaluate(() => localStorage.getItem('jd.token'))).toBe('tok1')
    expect([...seen]).toEqual(['Bearer tok1'])
})

test('a token in a link the user did not start sign-in from is ignored', async ({page}) => {
    const seen = authHeaders(page.github)
    await page.goto(`./?pr=${PR}#jd-auth=someone-elses&expires_in=28800`)
    await ready(page)
    expect(new URL(page.url()).hash).toBe('')
    expect(await page.evaluate(() => localStorage.getItem('jd.token'))).toBeNull()
    expect(seen.size).toBe(0)
})

test('a signed-in token that expired is renewed before it is used', async ({page, context}) => {
    const seen = authHeaders(page.github)
    await context.addInitScript(() => {
        localStorage.setItem('jd.token', 'old')
        localStorage.setItem('jd.tokenExpires', String(Date.now() - 1000))
    })
    let renewals = 0
    await context.route('**/auth/refresh', (r) => (renewals++, r.fulfill({json: {access_token: 'new', expires_in: 28800}})))
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    expect(renewals).toBe(1)
    expect([...seen]).toEqual(['Bearer new'])
})

/** Opens the start page with `items` in its storage, and the logout requests the Worker gets (their bodies) in `logouts`. */
async function withStorage(page, context, items) {
    const logouts = []
    await context.route('**/auth/config', (r) => r.fulfill({json: {clientId: 'cid', appSlug: 'jetdiff'}}))
    await context.route('**/auth/logout', (r) => { logouts.push(r.request().postDataJSON()); r.fulfill({status: 204}) })
    await page.goto('./')
    await page.evaluate(async (items) => {
        for (const [k, v] of Object.entries(items)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
        await (await caches.open('jd-api')).put('https://offline.jd/x/repos/a/b/pulls/1', new Response('{}'))
    }, items)
    await page.reload()
    await page.locator('#land-token').click()
    await page.locator('#tok-clear').click()
    return logouts
}
const keys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jd.')).sort())
const DATA = {'jd.recent': [{key: 'pr=a/b/1', title: 'A', label: 'a/b#1'}], 'jd.viewed.a/b/#1': ['x'], 'jd.viewed.a/b/#1.pending': {x: true},
    'jd.offline': [{owner: 'a', repo: 'b', prs: [{number: 1, title: 'A'}], at: 1}], 'jd.identity': {author: {name: 'A', email: 'a@example.com'}, committer: null},
    'jd.fontSize': 15, 'jd.edits': {'a/b#1': {head: 'h', files: {'x.txt': 'edited\n'}}}}

test('Sign out asks first, revokes the token, and removes the data saved on this device but not the edits', async ({page, context}) => {
    const logouts = await withStorage(page, context, {...DATA, 'jd.token': 'tok1', 'jd.tokenExpires': String(Date.now() + 3600000)})
    await expect(page.locator('#so-data')).toBeChecked()
    await expect(page.locator('#so-edits')).not.toBeChecked()
    await expect(page.locator('#dialog')).toContainText('Also remove my unpushed edits, the shelved ones too (1 file)')
    await page.locator('#so-go').click()
    await expect(page.locator('#toasts')).toContainText('Signed out')
    expect(logouts).toEqual([{token: 'tok1'}])
    expect(await keys(page)).toEqual(['jd.edits', 'jd.fontSize'])
    expect(await page.evaluate(() => caches.has('jd-api'))).toBe(false)
})

test('Remove token sends no token to this site, and removes the unpushed edits only when asked', async ({page, context}) => {
    const logouts = await withStorage(page, context, {...DATA, 'jd.token': 'ghp_pasted'})
    await page.locator('#so-data').uncheck()
    await page.locator('#so-edits').check()
    await page.locator('#so-go').click()
    await expect(page.locator('#toasts')).toContainText('Token removed')
    expect(logouts).toEqual([null])
    expect(await keys(page)).toEqual(Object.keys(DATA).filter((k) => k !== 'jd.edits').sort())
    expect(await page.evaluate(() => caches.has('jd-api'))).toBe(true)
})

test('a pasted token still works, and no sign-in shows where the site has none', async ({page}) => {
    const seen = authHeaders(page.github)
    await page.goto('./')
    await expect(page.locator('#land-signin')).toBeHidden()
    await page.locator('#land-token').click()
    await expect(page.locator('#tok-app')).toBeHidden()
    await page.locator('#tok').fill('ghp_pasted')
    await page.locator('#dialog button[type=submit]').click()
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    expect([...seen]).toEqual(['Bearer ghp_pasted'])
})

test('when GitHub\'s hourly limit without a token runs out, a toast offers to sign in, once', async ({page}) => {
    const reset = Math.floor(Date.now() / 1000) + 600
    // before fakePr's handlers, which answer the files' contents
    page.github.handle(({path}) => path.includes('/contents/')
        ? {status: 403, headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset)}, body: {message: 'API rate limit exceeded'}} : undefined)
    const {url} = fakePr(page.github, 920, [{filename: 'a.txt', old: 'a\n', new: 'b\n'}, {filename: 'b.txt', old: 'a\n', new: 'b\n'}])
    await page.goto(url)
    const ask = page.locator('.toast', {hasText: 'limit without sign-in, 60 requests an hour, is used up until'})
    await expect(ask).toHaveCount(1)
    await page.keyboard.press('Alt+ArrowRight')
    await expect(page.locator('#view-msg')).toContainText('rate limit')
    await expect(ask).toHaveCount(1)
    await ask.locator('.toast-action', {hasText: 'Sign In…'}).click()
    await expect(page.locator('#dialog #tok')).toBeVisible()
})
