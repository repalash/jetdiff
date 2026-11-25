import fs from 'node:fs'
import {test, expect, ready, recorded, FIXTURE_DIR, PR, HEAD} from './fixture.js'

const PWN = '<img src=x onerror="window.__pwned=1">'
const pwned = (page) => page.evaluate(() => !!window.__pwned)

test('a snapshot with markup in its data cannot run script or link outside GitHub', async ({page, context}) => {
    const index = JSON.parse(fs.readFileSync(new URL('index.json', FIXTURE_DIR)))
    const evil = {
        '/repos/repalash/threepipe/pulls/193': (pr) => ({...pr, number: PWN, html_url: 'javascript:window.__pwned=1', state: PWN}),
        '/repos/repalash/threepipe/pulls/193/files?per_page=100&page=1': (files) => files.map((f) => ({...f, status: `x" onmouseover="window.__pwned=1`, additions: PWN})),
    }
    const byFile = Object.fromEntries(Object.entries(evil).map(([k, f]) => [index[k].file, f]))
    await context.route('**/snap/evil/**', (route) => {
        const name = new URL(route.request().url()).pathname.split('/snap/evil/')[1]
        if (name === 'repos.json') return route.fulfill({json: [{owner: 'repalash', repo: 'threepipe', prs: [{number: PWN, title: 'x'}]}]})
        const body = fs.readFileSync(new URL(name, FIXTURE_DIR))
        route.fulfill({body: byFile[name] ? JSON.stringify(byFile[name](JSON.parse(body))) : body})
    })
    await page.goto('./?snap=evil')
    await expect(page.locator('#land-snap')).toContainText('1 pull requests')
    await page.goto(`./?snap=evil&pr=${PR}`)
    await ready(page)
    await page.locator('#tree .tr-file').first().hover()
    expect(await pwned(page)).toBe(false)
    expect(await page.locator('#btn-github').getAttribute('href')).toMatch(/^https:\/\/github\.com\//)
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
