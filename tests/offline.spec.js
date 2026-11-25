import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {test, expect, ready, FIXTURE_DIR, PR} from './fixture.js'

test.use({serviceWorkers: 'allow'})

const controlled = (page) => page.waitForFunction(() => navigator.serviceWorker.controller)

async function goOffline(context) {
    await context.unrouteAll({behavior: 'ignoreErrors'})
    await context.route('**', (route) => route.abort('internetdisconnected'))
    await context.setOffline(true)
}

test('a pull request opened before works with no network', async ({page, context}) => {
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await controlled(page)
    await page.reload()
    await ready(page)
    await page.locator('#btn-md-code').click()
    await ready(page)
    await goOffline(context)
    await page.reload()
    await ready(page)
    await expect(page.locator('#offline-pill')).toBeVisible()
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
    await page.goto(`./${PR.replace(/\/(\d+)$/, '/pull/$1')}`)
    await ready(page)
    expect(new URL(page.url()).searchParams.get('pr')).toBe(PR)
})

test('an offline pack imports, then opens with no network', async ({page, context}) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pack-'))
    execFileSync('python3', ['tools/make-pack.py', fileURLToPath(FIXTURE_DIR), out])
    await page.goto('./')
    await controlled(page)
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#land-pack').click()
    await (await chooser).setFiles(path.join(out, 'repalash-threepipe.zip'))
    await expect(page.locator('#toasts')).toContainText('Imported 1 pull requests', {timeout: 30000})
    await goOffline(context)
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await ready(page)
    await expect(page.locator('.mdp.two')).toBeVisible()
})
