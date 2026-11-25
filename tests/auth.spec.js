import {test, expect, ready, PR} from './fixture.js'

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
