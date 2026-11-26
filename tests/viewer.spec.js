import fs from 'node:fs'
import {test, expect, ready, FIXTURE_DIR, PR} from './fixture.js'

const fileParam = (page) => new URL(page.url()).searchParams.get('file')

test('opens a pull request: the files, a diff, next difference and next file', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(5)
    await expect(page.locator('#tree .tr-file.sel')).toHaveAttribute('data-file', 'plugins/cloud/src/auth/CloudAuth.ts')
    await expect(page.locator('.sbs-left .view-lines')).toBeVisible()
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
    await expect(page.locator('#diff-count')).toHaveText(/^\d+ differences$/)
    await page.locator('#btn-next-diff').click()
    await expect(page.locator('#st-pos')).toHaveText(/^Difference 2 of \d+$/)
    await page.locator('#btn-prev-diff').click()
    await expect(page.locator('#st-pos')).toHaveText(/^Difference 1 of \d+$/)
    await page.locator('#btn-next-file').click()
    await ready(page)
    expect(fileParam(page)).not.toBe('plugins/cloud/src/auth/CloudAuth.ts')
})

test('switches to the unified viewer and back', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await ready(page)
    await page.locator('#btn-unified').click()
    await expect(page.locator('.monaco-diff-editor:visible')).toBeVisible()
    await page.locator('#btn-sbs').click()
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
})

test('shows a changed Markdown file as a rich diff, and as code', async ({page}) => {
    await page.goto(`./?pr=${PR}&file=website/package/plugin-cloud.md`)
    await ready(page)
    await expect(page.locator('.mdp.two')).toBeVisible()
    await expect(page.locator('.mdp-new .md-ins').first()).toBeVisible()
    await expect(page.locator('.mdp-div')).toBeVisible()
    await page.locator('#btn-md-code').click()
    await expect(page.locator('.mdp')).toBeHidden()
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
})

test('selecting a commit in the log shows only its changes', async ({page}) => {
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    await page.locator('#tab-log').click()
    await expect(page.locator('#log-count')).toHaveText('3 commits')
    await page.locator('.lr[data-i="2"]').dblclick()
    await expect(page.locator('#tab-changes')).toHaveClass(/active/)
    await ready(page)
    await expect(page.locator('#pr-clear')).toBeVisible()
    const files = await page.locator('#tree .tr-file').count()
    expect(files).toBeLessThan(5)
    await page.locator('#pr-clear').click()
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(5)
})

test('the timeline shows the description and the conversation', async ({page}) => {
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    await page.locator('#pr-timeline').click()
    await expect(page.locator('#tab-timeline')).toHaveClass(/active/)
    await expect(page.locator('#timeline-host .md').first()).toContainText('sandboxed')
})

test('Search Everywhere opens a file', async ({page}) => {
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    await page.locator('body').click({position: {x: 5, y: 5}})
    await page.keyboard.press('Shift')
    await page.keyboard.press('Shift')
    await page.keyboard.type('auth.test')
    await page.keyboard.press('Enter')
    await ready(page)
    expect(fileParam(page)).toBe('plugins/cloud/tests/auth.test.ts')
})

test('a phone shows the files in a drawer and the diff fits the screen @phone', async ({page}) => {
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('#btn-drawer').click()
    await page.locator('#tree .tr-file[data-file="CHANGELOG.md"]').click()
    await ready(page)
    expect(fileParam(page)).toBe('CHANGELOG.md')
    await expect(page.locator('#tree')).not.toBeInViewport()
})

test('a snapshot link opens recorded pull requests without a token, read-only', async ({page, context}) => {
    await context.route('**/snap/fixture/**', (route) => route.fulfill({body: fs.readFileSync(new URL(new URL(route.request().url()).pathname.split('/snap/fixture/')[1], FIXTURE_DIR))}))
    await context.route('https://api.github.com/**', (route) => route.abort())
    await page.goto(`./?snap=fixture&pr=${PR}`)
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(5)
    await expect(page.locator('#btn-edit')).toBeHidden()
})

test('the start page opens a pasted GitHub URL', async ({page}) => {
    await page.goto('./')
    await expect(page.locator('.land-brand img')).toBeVisible()
    await expect(page.locator('.land-chip')).toHaveCount(4)
    await page.locator('#open-input').fill(`https://github.com/${PR.replace(/\/(\d+)$/, '/pull/$1')}/files`)
    await page.locator('#open-form button').click()
    await ready(page)
    expect(new URL(page.url()).searchParams.get('pr')).toBe(PR)
})

test('a GitHub link with the host swapped opens the same pull request', async ({page}) => {
    await page.goto(`./${PR.replace(/\/(\d+)$/, '/pull/$1')}/files`)
    await ready(page)
    expect(new URL(page.url()).searchParams.get('pr')).toBe(PR)
})

test('the start page offers a line for an agent\'s instructions file, and copies it', async ({page, context}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./')
    await expect(page.locator('#land-agent-line')).toContainText('jetdiff.com')
    await page.locator('#land-agent-copy').click()
    await expect(page.locator('#toasts')).toContainText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('replaced by `jetdiff.com`')
})

test('a browser too old for the app is told so instead of a blank page', async ({page, context}) => {
    const current = await context.newPage()
    await current.goto('./')
    await expect(current.locator('#landing')).toBeVisible()
    await expect(current.locator('#unsupported')).toBeHidden()
    await page.addInitScript(() => { HTMLScriptElement.supports = () => false })
    await page.goto('./')
    await expect(page.locator('#unsupported')).toBeVisible()
    await expect(page.locator('#unsupported')).toContainText('jetdiff needs a newer browser')
})
