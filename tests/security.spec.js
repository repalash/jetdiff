import fs from 'node:fs'
import {test, expect, ready, recorded, FIXTURE_DIR, PR, HEAD} from './fixture.js'

const PWN = '<img src=x onerror="window.__pwned=1">'
const pwned = (page) => page.evaluate(() => !!window.__pwned)

test('a snapshot from another site, opened after a yes, cannot run script or link outside GitHub with markup in its data', async ({page, context}) => {
    const index = JSON.parse(fs.readFileSync(new URL('index.json', FIXTURE_DIR)))
    const evil = {
        '/repos/repalash/threepipe/pulls/193': (pr) => ({...pr, number: PWN, html_url: 'javascript:window.__pwned=1', state: PWN}),
        '/repos/repalash/threepipe/pulls/193/files?per_page=100&page=1': (files) => files.map((f) => ({...f, status: `x" onmouseover="window.__pwned=1`, additions: PWN})),
    }
    const byFile = Object.fromEntries(Object.entries(evil).map(([k, f]) => [index[k].file, f]))
    await context.route('https://other.example/evil/**', (route) => {
        const name = new URL(route.request().url()).pathname.split('/evil/')[1]
        const headers = {'access-control-allow-origin': '*'}
        if (name === 'repos.json') return route.fulfill({headers, json: [{owner: 'repalash', repo: 'threepipe', prs: [{number: PWN, title: 'x'}]}]})
        const body = fs.readFileSync(new URL(name, FIXTURE_DIR))
        route.fulfill({headers, body: byFile[name] ? JSON.stringify(byFile[name](JSON.parse(body))) : body})
    })
    const snap = encodeURIComponent('https://other.example/evil/')
    await page.goto(`./?snap=${snap}`)
    await page.locator('#rec-open').click()
    await expect(page.locator('#land-snap')).toContainText('1 pull requests')
    expect(await pwned(page)).toBe(false)
    await page.goto(`./?snap=${snap}&pr=${PR}`)
    await ready(page)
    await page.locator('#tree .tr-file').first().hover()
    expect(await pwned(page)).toBe(false)
    expect(await page.locator('#btn-github').getAttribute('href')).toMatch(/^https:\/\/github\.com\//)
})

const fixtureFile = (url, prefix) => fs.readFileSync(new URL(new URL(url).pathname.split(prefix)[1], FIXTURE_DIR))
const snapSetting = (page) => page.evaluate(() => localStorage.getItem('jd.snap'))

test('recorded data from another site opens only after a yes, under a bar with Exit back to GitHub', async ({page, context}) => {
    let asked = 0
    await context.route('https://other.example/snap/**', (route) => {
        asked++
        route.fulfill({headers: {'access-control-allow-origin': '*', 'last-modified': 'Wed, 25 Nov 2026 10:00:00 GMT'}, body: fixtureFile(route.request().url(), '/snap/')})
    })
    const link = `./?snap=${encodeURIComponent('https://other.example/snap/')}&pr=${PR}`
    await page.goto(link)
    await expect(page.locator('#dialog h2')).toHaveText('Open recorded pull requests from other.example?')
    await page.locator('#rec-cancel').click()
    await ready(page)
    expect(asked).toBe(0)
    expect(await snapSetting(page)).toBeNull()
    await expect(page.locator('#rec-bar')).toHaveCount(0)

    await page.goto(link)
    await page.locator('#rec-open').click()
    await ready(page)
    expect(asked).toBeGreaterThan(0)
    expect(await snapSetting(page)).toBe('https://other.example/snap/')
    await expect(page.locator('#rec-bar')).toContainText('Recorded data from other.example · Nov 25, 2026')
    await page.locator('#rec-exit').click()
    await ready(page)
    await expect(page.locator('#rec-bar')).toHaveCount(0)
    expect(await snapSetting(page)).toBeNull()
})

test('a snapshot link opened before opens again with no question; a packs link from another site asks first', async ({page, context}) => {
    let asked = 0
    await context.route('https://other.example/packs/**', (route) => (asked++, route.abort()))
    await context.route('https://other.example/snap/**', (route) => route.fulfill({headers: {'access-control-allow-origin': '*'}, body: fixtureFile(route.request().url(), '/snap/')}))
    const link = `./?snap=${encodeURIComponent('https://other.example/snap/')}&pr=${PR}`
    await page.goto(link)
    await page.locator('#rec-open').click()
    await ready(page)
    await page.goto(link)
    await ready(page)
    await expect(page.locator('#dialog')).toBeHidden()
    await expect(page.locator('#rec-bar')).toContainText('Recorded data from other.example')
    await page.goto('./?snap=&packs=https://other.example/packs/')
    await expect(page.locator('#dialog h2')).toHaveText('Open recorded pull requests from other.example?')
    await page.locator('#rec-cancel').click()
    await expect(page.locator('#landing')).toBeVisible()
    expect(asked).toBe(0)
    expect(new URL(page.url()).searchParams.get('packs')).toBeNull()
})

test('a ?snap= or ?packs= value that is not an https URL opens nothing', async ({page, context}) => {
    let asked = 0
    await context.route(/\/(snap|packs)\//, (route) => (asked++, route.abort()))
    await page.goto(`./?snap=fixture&packs=packs/&pr=${PR}`)
    await ready(page)
    await expect(page.locator('#dialog')).toBeHidden()
    await expect(page.locator('#rec-bar')).toHaveCount(0)
    expect(await snapSetting(page)).toBeNull()
    expect(asked).toBe(0)
})

test('a Markdown file cannot smuggle a javascript: link, a form or a style through the change marks', async ({page}) => {
    const path = '/repos/repalash/threepipe/contents/website/package/plugin-cloud.md?ref=' + HEAD
    const original = fs.readFileSync(new URL(JSON.parse(fs.readFileSync(new URL('index.json', FIXTURE_DIR)))[path].file, FIXTURE_DIR), 'utf8')
    const payload = '\n<a href="javascript:window.__pwned=1">x</a>\n<form action="javascript:window.__pwned=1"><button>go</button></form>\n<style>body{display:none}</style>\n<div id="dialog">fake</div>\n'
    page.github.handle(({path: p}) => p === path ? {raw: original + payload} : null)
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await ready(page)
    await expect(page.locator('.mdp-new')).toBeVisible()
    expect(await page.evaluate(() => [...document.querySelectorAll('.mdp [href], .mdp [action]')]
        .filter((e) => /^\s*javascript:/i.test(e.getAttribute('href') || e.getAttribute('action'))).length)).toBe(0)
    await expect(page.locator('.mdp form, .mdp style, .mdp button, .mdp #dialog')).toHaveCount(0)
    await page.locator('.mdp-new a', {hasText: 'x'}).last().click({force: true}).catch(() => {})
    expect(await pwned(page)).toBe(false)
})
