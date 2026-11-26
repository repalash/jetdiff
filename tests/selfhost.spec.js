import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {test, expect, ready, FIXTURE_DIR, PR} from './fixture.js'
import {checkVendor, FILES, ROOT, vendor} from '../tools/site.mjs'
import {CONTENT_SECURITY_POLICY} from '../worker/headers.js'

test.use({serviceWorkers: 'allow'})

const GITHUB_HOSTS = ['api.github.com', 'avatars.githubusercontent.com']
const PNG = fs.readFileSync(new URL('../icons/icon-192.png', import.meta.url))

test('index.html names the installed libraries, and the policy allows its import map', async () => {
    expect(await checkVendor()).toBeNull()
})

// Cloudflare's asset server answers a path that encodeURIComponent changes (a segment's @, +, space…) with a redirect
// to the encoded path
test('no path the site serves changes when encoded', async () => {
    const list = (f) => fs.statSync(path.join(ROOT, f)).isDirectory() ? fs.readdirSync(path.join(ROOT, f)).flatMap((e) => list(`${f}/${e}`)) : [f]
    const paths = [...FILES.flatMap(list), 'sw.js', ...vendor().files.keys()]
    expect(paths.length).toBeGreaterThan(600)
    expect(paths.filter((p) => p.split('/').some((s) => encodeURIComponent(s) !== s))).toEqual([])
})

test('a first visit is answered with no redirect, and the libraries get the security headers', async ({page, context, request}) => {
    const redirects = []
    // the page's requests and the service worker's, which fetches the release and the libraries at install
    context.on('response', (r) => { if (r.status() >= 300 && r.status() < 400) redirects.push(`${r.status()} ${r.url()}`) })
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await ready(page)
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    const kept = await page.evaluate(() => caches.open('jd-libs').then((c) => c.keys()).then((ks) => ks.length))
    expect(kept).toBeGreaterThanOrEqual(vendor().start.length)
    expect(redirects).toEqual([])

    // the libraries skip the Worker (wrangler.jsonc): their headers come from dist/_headers
    const lib = await request.get(vendor().importMap.imports.dompurify)
    expect(lib.status()).toBe(200)
    expect(lib.headers()).toMatchObject({'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin'})
    const missing = await request.get('./vendor/none/1.0.0/none.js')
    expect(missing.status()).toBe(404)
    expect(missing.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
})

test('the app loads everything from the site: only GitHub is asked for anything else', async ({page, context}) => {
    const hosts = new Set()
    // the page's requests and the service worker's
    context.on('request', (r) => hosts.add(new URL(r.url()).host))
    await context.route('https://avatars.githubusercontent.com/**', (route) => route.fulfill({headers: {'access-control-allow-origin': '*', 'content-type': 'image/png'}, body: PNG}))
    await page.goto('./')
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await ready(page)
    // the TypeScript service, in its worker from the site
    await page.locator('.sbs-right .view-line', {hasText: 'export class CloudAuth'}).locator('span span', {hasText: 'CloudAuth'}).first().hover()
    await expect(page.locator('.monaco-hover:visible')).toContainText('class CloudAuth', {timeout: 20000})
    // highlighted by Shiki's grammar: tokens of several colors
    await expect.poll(() => page.evaluate(() => new Set([...document.querySelectorAll('.sbs-right .view-line span[class^="mtk"]')].map((s) => s.className)).size)).toBeGreaterThan(3)
    await page.locator('#btn-unified').click()
    await expect(page.locator('.monaco-diff-editor:visible')).toBeVisible()
    await page.locator('#btn-sbs').click()
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await ready(page)
    await expect(page.locator('.mdp.two code .line').first()).toBeVisible()
    await page.locator('#tab-log').click()
    await page.locator('#pr-timeline').click()
    await expect(page.locator('#timeline-host img.tl-av').first()).toBeVisible()
    // the web fonts, from the site
    expect(await page.evaluate(() => [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))].sort()))
        .toEqual(['Inter', 'JetBrains Mono'])
    // Download for offline, and a pack (fflate)
    await page.evaluate(() => import('/js/offline.js').then((m) => m.downloadRepo('repalash', 'threepipe', {numbers: [193], commits: false})))
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pack-'))
    execFileSync('python3', ['tools/make-pack.py', fileURLToPath(FIXTURE_DIR), out])
    await page.goto('./')
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#land-pack').click()
    await (await chooser).setFiles(path.join(out, 'repalash-threepipe.zip'))
    await expect(page.locator('#toasts')).toContainText('Imported 1 pull requests', {timeout: 30000})

    expect(hosts).toContain('api.github.com')
    expect([...hosts].filter((h) => h !== new URL(page.url()).host && !GITHUB_HOSTS.includes(h))).toEqual([])
    // what the page starts with was kept at install, from the site
    const kept = await page.evaluate(() => caches.open('jd-libs').then((c) => c.keys()).then((ks) => ks.map((k) => new URL(k.url).pathname)))
    for (const f of vendor().start) expect(kept).toContain('/' + f)
})
