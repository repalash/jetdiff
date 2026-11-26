import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {test, expect, ready, recorded, FIXTURE_DIR, PR, HEAD} from './fixture.js'
import {CONTENT_SECURITY_POLICY} from '../worker/headers.js'

test.use({serviceWorkers: 'allow', token: true})

const PNG = fs.readFileSync(new URL('../icons/icon-192.png', import.meta.url))

/** Records the page's policy violations, as events and as console errors, in `page.problems`. */
async function watch(page, context) {
    page.problems = []
    await context.exposeBinding('cspViolation', (_, v) => page.problems.push(v))
    await context.addInitScript(() => document.addEventListener('securitypolicyviolation',
        (e) => window.cspViolation(`${e.violatedDirective}: ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`), true))
    // not the network's errors: the fixture answers 404 for what it did not record, and the test goes offline
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|^Refused to/i.test(m.text())) page.problems.push(`console: ${m.text()}`) })
    // avatars, as the timeline and the log show them
    await context.route('https://avatars.githubusercontent.com/**', (route) => route.fulfill({headers: {'access-control-allow-origin': '*', 'content-type': 'image/png'}, body: PNG}))
}

test('the pages are served with the policy, and the app runs under it with no violation', async ({page, context}) => {
    await watch(page, context)
    const pr = recorded('/repos/repalash/threepipe/pulls/193')
    // open, so that it can be edited
    page.github.handle(({method, path}) => {
        if (path === '/repos/repalash/threepipe/pulls/193') return {...pr, state: 'open'}
        if (method === 'GET' && path.includes('/git/ref/')) return {object: {sha: HEAD}}
    })

    const res = await page.goto('./')
    expect(res.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    await expect(page.locator('.land-brand img')).toBeVisible()
    await page.waitForFunction(() => navigator.serviceWorker.controller)

    // the side-by-side and unified views, the Markdown preview
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await ready(page)
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
    await page.locator('#btn-unified').click()
    await expect(page.locator('.monaco-diff-editor:visible')).toBeVisible()
    await page.locator('#btn-sbs').click()
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await ready(page)
    await expect(page.locator('.mdp.two')).toBeVisible()

    // Log, Timeline, Search Everywhere
    await page.locator('#tab-log').click()
    await expect(page.locator('#log-count')).toHaveText('3 commits')
    await page.locator('#pr-timeline').click()
    await expect(page.locator('#timeline-host .md').first()).toContainText('sandboxed')
    await page.locator('#tab-changes').click()
    await page.locator('body').click({position: {x: 5, y: 5}})
    await page.keyboard.press('Shift')
    await page.keyboard.press('Shift')
    await page.keyboard.type('auth.test')
    await page.keyboard.press('Enter')
    await ready(page)
    // a light theme, from Search Everywhere's actions
    await page.keyboard.press('Shift')
    await page.keyboard.press('Shift')
    await page.keyboard.type('Theme: Material Lighter')
    await page.keyboard.press('Enter')
    await expect(page.locator('#toasts')).toContainText('Material Lighter')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await ready(page)

    // edits
    await page.locator('#btn-edit').click()
    await page.locator('.sbs-right .view-line').nth(3).click()
    await page.keyboard.type(' // edited')
    await expect(page.locator('#btn-commit')).toBeVisible()

    // offline, from the service worker's copy, which keeps the policy
    await context.route('**', (route) => route.abort('internetdisconnected'))
    await context.setOffline(true)
    await page.reload()
    await ready(page)
    expect(await page.evaluate(() => fetch('./').then((r) => r.headers.get('content-security-policy')))).toBe(CONTENT_SECURITY_POLICY)
    await context.setOffline(false)
    await context.unrouteAll({behavior: 'ignoreErrors'})

    expect(page.problems).toEqual([])
})

test('a pack imports, and a GitHub-style path redirects, with no violation', async ({page, context}) => {
    await watch(page, context)
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pack-'))
    execFileSync('python3', ['tools/make-pack.py', fileURLToPath(FIXTURE_DIR), out])
    await page.goto('./')
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#land-pack').click()
    await (await chooser).setFiles(path.join(out, 'repalash-threepipe.zip'))
    await expect(page.locator('#toasts')).toContainText('Imported 1 pull requests', {timeout: 30000})

    const res = await page.goto(`./${PR.replace(/\/(\d+)$/, '/pull/$1')}`)
    expect(res.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    await ready(page)
    expect(new URL(page.url()).searchParams.get('pr')).toBe(PR)
    expect(page.problems).toEqual([])
})

test('the policy is enforced: an injected script does not run', async ({page, context}) => {
    await watch(page, context)
    await page.goto('./')
    await expect(page.locator('.land-brand img')).toBeVisible()
    await page.evaluate(() => {
        const s = document.createElement('script')
        s.textContent = 'window.injected = 1'
        document.head.append(s)
        const img = document.createElement('img')
        img.setAttribute('onerror', 'window.injected = 1')
        img.src = 'data:,'
        document.body.append(img)
    })
    await expect.poll(() => page.problems.length).toBeGreaterThanOrEqual(2)
    expect(await page.evaluate(() => window.injected)).toBeUndefined()
    expect(page.problems.filter((p) => !p.startsWith('console:')).every((p) => p.startsWith('script-src'))).toBe(true)
})
