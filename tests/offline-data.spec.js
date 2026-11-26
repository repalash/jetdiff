import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {test, expect, ready, recorded, fakePr, FIXTURE_DIR, PR, HEAD} from './fixture.js'

const R = '/repos/repalash/threepipe'
const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const contentsUrl = (path, ref) => `https://api.github.com${R}/contents/${path}?ref=${ref}`
const cors = {'access-control-allow-origin': '*', 'access-control-expose-headers': '*'}

const offlineDialog = async (page) => {
    await page.locator('#btn-app').click()
    await page.locator('.menu-item', {hasText: 'Offline: Download'}).click()
    await expect(page.locator('#dialog .off-list')).toBeVisible()
}
const offlineList = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('jd.offline') || '[]'))
const download = (page, opts) => page.evaluate((opts) => import('/js/offline.js').then((m) => m.downloadRepo('repalash', 'threepipe', opts)), opts)
const cacheKeys = (page, name) => page.evaluate((name) => caches.open(name).then((c) => c.keys()).then((ks) => ks.map((k) => k.url)), name)
const quotaFull = () => { Cache.prototype.put = () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')) }

/** The fixture as an offline pack, without the snapshot files `without`. */
function fixturePack(without = []) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pack-'))
    execFileSync('python3', ['tools/make-pack.py', fileURLToPath(FIXTURE_DIR), out])
    const zip = path.join(out, 'repalash-threepipe.zip')
    if (without.length) execFileSync('python3', ['-c', `import sys, zipfile
src, drop = sys.argv[1], set(sys.argv[2:])
items = [(i, zipfile.ZipFile(src).read(i)) for i in zipfile.ZipFile(src).infolist() if i.filename.split('/')[-1] not in drop]
with zipfile.ZipFile(src, 'w') as z:
    for i, data in items: z.writestr(i, data)`, zip, ...without])
    return zip
}

async function importPack(page, zip) {
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#land-pack').click()
    await (await chooser).setFiles(zip)
    await expect(page.locator('#toasts')).toContainText('Imported 1 pull requests', {timeout: 30000})
}

test('a page that cannot keep a file contents says the storage is full, and the download saves nothing', async ({page}) => {
    await page.addInitScript(quotaFull)
    await page.goto('./')
    const res = await download(page, {numbers: [193], commits: false})
    expect(res).toMatchObject({prs: 0, full: true})
    expect(await offlineList(page)).toEqual([])
})

test('only the pull requests whose changes loaded are counted and listed as saved', async ({page}) => {
    await page.goto('./')
    const res = await download(page, {numbers: [193, 999999], commits: false})
    expect(res.prs).toBe(1)
    expect((await offlineList(page))[0].prs.map((p) => p.number)).toEqual([193])
})

test('Remove all saved data is offered once browsing kept something', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await offlineDialog(page)
    await expect(page.locator('#dialog .off-list')).toContainText('Nothing downloaded yet')
    await expect(page.locator('#off-clear')).toBeEnabled()
})

test('a download right after Remove all saved data saves the files this tab had read', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await offlineDialog(page)
    const saveOne = async () => {
        await page.locator('#off-commits').uncheck()
        await page.locator('#off-one').click()
        await expect(page.locator('#toasts .toast', {hasText: '1 pull request saved for offline'})).toHaveCount(1, {timeout: 30000})
        await page.locator('#toasts .toast').evaluateAll((ts) => ts.forEach((t) => t.remove()))
    }
    await saveOne()
    page.once('dialog', (d) => d.accept())
    await page.locator('#off-clear').click()
    await expect(page.locator('#toasts')).toContainText('Saved data removed')
    expect(await cacheKeys(page, 'jd-contents-v1')).toEqual([])
    await saveOne()
    expect(await cacheKeys(page, 'jd-contents-v1')).toContain(contentsUrl(FILE, HEAD))
})

test('removing a repository keeps the data of one whose name starts the same', async ({page}) => {
    await page.goto('./')
    const urls = {
        'jd-api': ['https://offline.jd/x/search/issues?q=repo%3Aa%2Fb%20is%3Apr', 'https://offline.jd/x/search/issues?q=repo%3Aa%2Fbc%20is%3Apr',
            'https://offline.jd/x/repos/a/b/pulls/1', 'https://offline.jd/x/repos/a/b.c/pulls/1'],
        'jd-contents-v1': ['https://api.github.com/repos/a/b/contents/x?ref=1', 'https://api.github.com/repos/a/bc/contents/x?ref=1'],
    }
    await page.evaluate(async (urls) => {
        for (const [name, list] of Object.entries(urls)) {
            const c = await caches.open(name)
            for (const u of list) await c.put(u, new Response('{}'))
        }
        await (await import('/js/offline.js')).removeRepo('a', 'b')
    }, urls)
    expect(await cacheKeys(page, 'jd-api')).toEqual([urls['jd-api'][1], urls['jd-api'][3]])
    expect(await cacheKeys(page, 'jd-contents-v1')).toEqual([urls['jd-contents-v1'][1]])
})

const noGitHub = (page) => page.route('https://api.github.com/**', (route) => route.abort('internetdisconnected'))

test('a file missing from an imported pack is not shown as empty', async ({page}) => {
    const index = JSON.parse(fs.readFileSync(new URL('index.json', FIXTURE_DIR)))
    const missing = index[`${R}/contents/${FILE}?ref=${HEAD}`].file
    await page.goto('./')
    await importPack(page, fixturePack([missing]))
    await noGitHub(page)
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('#view-msg')).toContainText('Not in the imported packs')
})

test('imported packs leave the app live online, and answer for GitHub when it cannot be reached', async ({page, context}) => {
    await context.route('**/auth/config', (r) => r.fulfill({json: {clientId: 'cid', appSlug: 'jetdiff'}}))
    await page.goto('./')
    await importPack(page, fixturePack())
    await page.goto('./')
    await expect(page.locator('#land-signin')).toBeVisible()
    await expect(page.locator('.land-lists h3').first()).toContainText('Available offline')
    await expect(page.locator('.land-list').first().locator('.li-label')).toHaveText('repalash/threepipe#193')
    // online: a pull request the pack does not hold
    const other = fakePr(page.github, 9020, [{filename: 'a.txt', old: 'a\n', new: 'b\n'}])
    await page.goto(other.url)
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(1)
    await expect(page.locator('#rec-bar')).toHaveCount(0)
    await noGitHub(page)
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
    await expect(page.locator('#offline-pill')).toBeVisible()
    await expect(page.locator('#rec-bar')).toHaveText('Saved copy from an offline pack')
})

test('importing a pack asks to keep the storage', async ({page}) => {
    await page.addInitScript(() => {
        window.persistAsked = 0
        if (navigator.storage) navigator.storage.persist = async () => { window.persistAsked++; return true }
    })
    await page.goto('./')
    await importPack(page, fixturePack())
    expect(await page.evaluate(() => window.persistAsked)).toBeGreaterThan(0)
})

test('Stop aborts the requests a download has under way', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    let release
    const held = new Promise((r) => { release = r })
    let arrived
    const asked = new Promise((r) => { arrived = r })
    await page.route(`https://api.github.com${R}/issues/193/comments**`, async (route) => {
        arrived()
        await held
        await route.fallback().catch(() => {})
    })
    const failed = page.waitForEvent('requestfailed', (r) => r.url().includes('/issues/193/comments'))
    await offlineDialog(page)
    await page.locator('#off-commits').uncheck()
    await page.locator('#off-one').click()
    await asked
    await page.locator('#off-close').click()
    await failed
    await expect(page.locator('#toasts')).toContainText('Download stopped')
    release()
})

test('the offline pill goes once the view is loaded again from the network', async ({page}) => {
    await page.route(`https://api.github.com${R}/pulls/193`, (route) => route.fulfill({
        headers: {...cors, 'content-type': 'application/json', 'x-jd-offline': '1'}, body: JSON.stringify(recorded(`${R}/pulls/193`)),
    }), {times: 1})
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('#offline-pill')).toBeVisible()
    await page.locator('#btn-reload').click()
    await ready(page)
    await expect(page.locator('#offline-pill')).toBeHidden()
})

test.describe('with the service worker', () => {
    test.use({serviceWorkers: 'allow'})

    const controlled = (page) => page.waitForFunction(() => navigator.serviceWorker.controller)

    test('a storage the service worker cannot write to stops the download and says so', async ({page, context}) => {
        await page.goto(`./?pr=${PR}&file=${FILE}`)
        await controlled(page)
        await ready(page)
        await context.serviceWorkers()[0].evaluate(quotaFull)
        await offlineDialog(page)
        await page.locator('#off-commits').uncheck()
        await page.locator('#off-one').click()
        await expect(page.locator('#toasts')).toContainText('storage of this device is full', {timeout: 30000})
        expect(await offlineList(page)).toEqual([])
    })

    test('avatars and libraries are kept readable, never opaque', async ({page, context}) => {
        const png = fs.readFileSync(new URL('../icons/icon-192.png', import.meta.url))
        await context.route('https://avatars.githubusercontent.com/**', (route) => route.fulfill({headers: {...cors, 'content-type': 'image/png'}, body: png}))
        await page.goto(`./?pr=${PR}&file=${FILE}`)
        await controlled(page)
        await page.reload()
        await ready(page)
        await page.locator('#pr-timeline').click()
        await expect(page.locator('#timeline-host img.tl-av').first()).toHaveAttribute('crossorigin', 'anonymous')
        await download(page, {numbers: [193], commits: false})
        const kept = await page.evaluate(async () => {
            const c = await caches.open('jd-libs')
            return Promise.all((await c.keys()).map(async (k) => [new URL(k.url).host, (await c.match(k)).type]))
        })
        expect(kept.filter(([host]) => host === 'avatars.githubusercontent.com').length).toBeGreaterThan(0)
        expect(kept.filter(([host]) => host === new URL(page.url()).host).length).toBeGreaterThan(0)
        expect(kept.filter(([, type]) => type === 'opaque')).toEqual([])
    })

    test('snapshot files and packs are not kept as the app, and a snapshot still opens offline', async ({page, context}) => {
        await context.route('**/snap/fixture/**', (route) => route.fulfill({body: fs.readFileSync(new URL(new URL(route.request().url()).pathname.split('/snap/fixture/')[1], FIXTURE_DIR))}))
        await context.route('**/packs/**', (route) => route.fulfill({body: '[]'}))
        await page.goto(`./?snap=fixture&pr=${PR}&file=${FILE}`)
        await controlled(page)
        await page.reload()
        await ready(page)
        await page.evaluate(() => Promise.all(['./packs/packs.json', './packs/a.zip'].map((u) => fetch(u))))
        const shell = await page.evaluate(async () => (await caches.keys()).find((k) => k.startsWith('jd-shell-')))
        const kept = await cacheKeys(page, shell)
        expect(kept.filter((u) => /\/snap\/|\/packs\//.test(u))).toEqual([])
        expect(kept.some((u) => u.endsWith('/js/main.js'))).toBe(true)
        await context.unrouteAll({behavior: 'ignoreErrors'})
        await context.route('**', (route) => route.abort('internetdisconnected'))
        await context.setOffline(true)
        await page.reload()
        await ready(page)
        await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
    })
})
