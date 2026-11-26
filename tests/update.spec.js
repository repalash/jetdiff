import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {test, expect, ready, PR} from './fixture.js'
import {FILES, ROOT} from '../tools/site.mjs'

test.use({serviceWorkers: 'allow'})

const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const MARK = '// release B'
// the sites of these tests' own are next to the tests' one (playwright.config.js)
const PORT = +(process.env.TEST_PORT || 4173)

/** A copy of the site's sources, with the installed libraries. */
function copySite() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-release-'))
    for (const f of [...FILES, 'sw.js', 'tools', 'worker', 'package.json', 'wrangler.jsonc']) fs.cpSync(path.join(ROOT, f), path.join(dir, f), {recursive: true})
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'))
    return dir
}

/** wrangler dev on a copy of the site (no .dev.vars: no sign-in), on `port`: changing its files builds a new release. */
async function serveCopy(port) {
    const dir = copySite()
    const server = spawn(path.join(ROOT, 'node_modules/.bin/wrangler'), ['dev', '--ip', '127.0.0.1', '--port', String(port)], {cwd: dir})
    let log = ''
    await new Promise((resolve, reject) => {
        for (const out of [server.stdout, server.stderr]) out.on('data', (d) => { log += d; if (/Ready on/.test(log)) resolve() })
        server.on('exit', (code) => reject(new Error(`wrangler dev exited (${code}):\n${log}`)))
    })
    const url = `http://localhost:${port}/`
    return {
        url,
        // release B: index.html and util.js changed, once wrangler dev serves its build
        releaseB: async () => {
            fs.appendFileSync(path.join(dir, 'js/util.js'), `\n${MARK}\n`)
            const index = path.join(dir, 'index.html')
            fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<head>', '<head>\n<meta name="jd-release" content="B">'))
            await expect.poll(() => fetch(url + 'js/util.js').then((r) => r.text()), {timeout: 30000}).toContain(MARK)
        },
        close: async () => {
            const exited = new Promise((resolve) => server.once('exit', resolve))
            server.kill()
            await exited
            fs.rmSync(dir, {recursive: true, force: true})
        },
    }
}

const util = (page) => page.evaluate(() => fetch('./js/util.js').then((r) => r.text()))
const shellCaches = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('jd-shell-')))
const lookForUpdate = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).catch(() => {}))

async function openApp(page, site) {
    await page.goto(`${site.url}?pr=${PR}&file=${FILE}`)
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    await ready(page)
    await page.evaluate(() => import('./js/update.js').then((m) => m.onAppUpdate(() => { window.updated = true })))
}

test('a new release arrives whole: the open page keeps its own until it reloads, and is told', async ({page}) => {
    const site = await serveCopy(PORT + 1)
    try {
        await openApp(page, site)
        const [a] = await shellCaches(page)
        await site.releaseB()
        await lookForUpdate(page)
        await page.waitForFunction(() => window.updated, null, {timeout: 20000})
        // the page goes on with release A's files
        expect(await util(page)).not.toContain(MARK)
        await page.locator('#btn-next-file').click()
        await ready(page)
        await expect(page.locator('meta[name="jd-release"]')).toHaveCount(0)
        const both = await shellCaches(page)
        expect(both).toHaveLength(2)
        // a reload brings release B, and release A's files go once no page uses them
        await page.reload()
        await ready(page)
        await expect(page.locator('meta[name="jd-release"]')).toHaveCount(1)
        expect(await util(page)).toContain(MARK)
        await expect.poll(() => shellCaches(page)).toEqual(both.filter((k) => k !== a))
    } finally { await site.close() }
})

test('a release one of whose files does not arrive is not used', async ({page, context}) => {
    const site = await serveCopy(PORT + 2)
    try {
        await openApp(page, site)
        await site.releaseB()
        await context.route('**/js/tree.js', (route) => route.fulfill({status: 404}))
        await lookForUpdate(page)
        // the new worker gave up
        await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !r.installing && !r.waiting))
        await page.reload()
        await ready(page)
        expect(await page.evaluate(() => window.updated)).toBeUndefined()
        await expect(page.locator('meta[name="jd-release"]')).toHaveCount(0)
        expect(await util(page)).not.toContain(MARK)
        expect(await shellCaches(page)).toHaveLength(1)
    } finally { await site.close() }
})

// the pages a release keeps carry the headers they were served with, the policy among them
test('a change to the security headers alone starts a new release', async () => {
    const dir = copySite()
    try {
        const release = async () => (await import(`${pathToFileURL(path.join(dir, 'tools/site.mjs')).href}?${Math.random()}`))
            .serviceWorker().match(/^const RELEASE = '(\w+)'/m)[1]
        const a = await release()
        const headers = path.join(dir, 'worker/headers.js')
        fs.writeFileSync(headers, fs.readFileSync(headers, 'utf8').replace("\"object-src 'none'\",", "\"object-src 'none'\", \"upgrade-insecure-requests\","))
        expect(await release()).not.toBe(a)
    } finally { fs.rmSync(dir, {recursive: true, force: true}) }
})
