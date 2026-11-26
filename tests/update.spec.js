import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test, expect, ready, PR} from './fixture.js'
import {FILES, ROOT} from '../tools/site.mjs'

test.use({serviceWorkers: 'allow'})

const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const MARK = '// release B'

/** A dev server of its own, on a copy of the site: changing its files makes a new release. */
async function serveCopy() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-release-'))
    for (const f of [...FILES, 'sw.js', 'tools', 'worker', 'package.json']) fs.cpSync(path.join(ROOT, f), path.join(dir, f), {recursive: true})
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'))
    const server = spawn(process.execPath, ['tools/serve.mjs'], {cwd: dir, env: {...process.env, PORT: '0'}})
    const url = await new Promise((resolve, reject) => {
        server.stdout.on('data', (d) => { const m = /http:\/\/localhost:\d+\//.exec(String(d)); if (m) resolve(m[0]) })
        server.on('exit', reject)
    })
    return {
        url,
        // release B: index.html and util.js changed
        releaseB: () => {
            fs.appendFileSync(path.join(dir, 'js/util.js'), `\n${MARK}\n`)
            const index = path.join(dir, 'index.html')
            fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<head>', '<head>\n<meta name="jd-release" content="B">'))
        },
        file: (f) => path.join(dir, f),
        close: () => { server.kill(); fs.rmSync(dir, {recursive: true, force: true}) },
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
    const site = await serveCopy()
    try {
        await openApp(page, site)
        const [a] = await shellCaches(page)
        site.releaseB()
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
    } finally { site.close() }
})

test('a release one of whose files does not arrive is not used', async ({page}) => {
    const site = await serveCopy()
    try {
        await openApp(page, site)
        site.releaseB()
        fs.rmSync(site.file('js/tree.js'))
        await lookForUpdate(page)
        // the new worker gave up
        await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !r.installing && !r.waiting))
        await page.reload()
        await ready(page)
        expect(await page.evaluate(() => window.updated)).toBeUndefined()
        await expect(page.locator('meta[name="jd-release"]')).toHaveCount(0)
        expect(await util(page)).not.toContain(MARK)
        expect(await shellCaches(page)).toHaveLength(1)
    } finally { site.close() }
})
