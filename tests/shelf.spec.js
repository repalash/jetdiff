import fs from 'node:fs'
import {strFromU8, unzipSync} from 'fflate'
import {test, expect, ready, recorded, PR, HEAD} from './fixture.js'

test.use({token: true})

const R = '/repos/repalash/threepipe'
const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const FILE2 = 'plugins/cloud/tests/auth.test.ts'
const OLD = 'beef'.padEnd(40, '0')
const KEY = 'repalash/threepipe#193'
const pr = recorded(`${R}/pulls/193`)

/** The recorded pull request, open so that its files can be edited. OLD, an older head, reads as its head but for the files `changed`. */
function openPr(github, changed = []) {
    github.alias[OLD] = HEAD
    github.handle(({method, path}) => {
        if (path === `${R}/pulls/193`) return {...pr, state: 'open'}
        if (method === 'GET' && changed.some((f) => path === `${R}/contents/${f}?ref=${OLD}`)) return {raw: 'the file before\n'}
    })
}

/** Stores the PR's edits (`files`, made on its head) and Shelf before the first load only. */
const seedEdits = (page, files, shelf) => page.addInitScript((v) => {
    if (localStorage.getItem('jd.edits') === null) localStorage.setItem('jd.edits', v)
}, JSON.stringify({[KEY]: {head: HEAD, files, shelf}}))

const storedEdits = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('jd.edits') || '{}')[k], KEY)

const DAY = Date.parse('2026-11-20T10:00:00Z')
const entry = (id, name, files, at = DAY) => ({id, name, date: at, files: files.map(([path, text, head = HEAD]) => ({path, head, text}))})

async function openShelf(page) {
    await page.locator('#strip-commit').click()
    await page.locator('#stab-shelf').click()
}

const fileRow = (page, path, id) => page.locator(`#shelf .sh-file[data-path="${path}"]${id ? `[data-id="${id}"]` : ''}`)

test('an edit that clashes with a push is shelved: it shows against the current version, read-only, and cannot be unshelved', async ({page}) => {
    openPr(page.github, [FILE])
    await page.addInitScript((v) => { if (localStorage.getItem('jd.edits') === null) localStorage.setItem('jd.edits', v) },
        JSON.stringify({[KEY]: {head: OLD, files: {[FILE]: 'my edit\n'}}}))
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await expect(page.locator('#toasts')).toContainText(`Your edits of ${FILE} are shelved: changed on GitHub since`)
    await page.locator('.toast-action', {hasText: 'Show'}).click()
    await expect(page.locator('#stab-shelf')).toHaveClass(/active/)
    await expect(page.locator('#stab-shelf-n')).toHaveText('1')
    await expect(page.locator('#shelf .sh-entry')).toHaveCount(1)
    await expect(page.locator('#shelf .sh-entry')).toContainText('Changed on GitHub since edited')
    await expect(page.locator('#shelf .sh-entry')).toHaveClass(/sel/)
    const unshelve = page.locator('#sh-unshelve')
    await expect(unshelve).toHaveAttribute('aria-disabled', 'true')
    await expect(unshelve).toHaveAttribute('title', `CloudAuth.ts changed on GitHub since this edit (made on ${OLD.slice(0, 8)}): unshelving it needs a merge, not built yet`)
    // a tap says why, as touch screens show no tips
    await unshelve.click({force: true})
    await expect(page.locator('#toasts')).toContainText('unshelving it needs a merge')
    expect((await storedEdits(page)).shelf[0].files).toEqual([{path: FILE, head: OLD, text: 'my edit\n'}])

    await fileRow(page, FILE).click()
    await expect(page.locator('.sbs-head-left')).toContainText(`shelved${FILE}`)
    await expect(page.locator('.sbs-head-left')).toContainText(`edited on ${OLD.slice(0, 8)}`)
    await expect(page.locator('.sbs-head-right')).toContainText(`${HEAD.slice(0, 8)}Current version`)
    await expect(page.locator('.sbs-left .view-lines')).toContainText('my edit')
    await expect(page.locator('.sbs-right .view-lines')).toContainText('/api/v1/connect')
    await expect(page.locator('#toolbar')).toHaveClass(/outside/)
    await expect(page.locator('#btn-edit')).toBeHidden()
    await expect(page.locator('#chk-viewed')).toBeHidden()
    // back to the changed files
    await page.locator('#strip-commit').click()
    await page.locator(`#tree .tr-file[data-file="${FILE2}"]`).click()
    await expect(page.locator('#toolbar')).not.toHaveClass(/outside/)
    await expect(page.locator('.sbs-head-left')).not.toContainText('shelved')
})

test('Unshelve makes shelved edits current again where their file did not change since', async ({page}) => {
    openPr(page.github)
    await seedEdits(page, {}, [entry('a', 'Tidy the sign-in', [[FILE, 'shelved text\n', OLD], [FILE2, 'second\n']])])
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await openShelf(page)
    await fileRow(page, FILE).click()
    await expect(page.locator('.sbs-head-left')).toContainText('shelved')
    const unshelve = page.locator('#sh-unshelve')
    await expect(unshelve).toHaveAttribute('aria-disabled', 'false')
    await unshelve.click()
    await expect(page.locator('#toasts')).toContainText(`Unshelved ${FILE}: edited here now`)
    // the file shows as edited, at the head
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE)
    await expect(page.locator('.sbs-head-right .tag-ed')).toHaveText('edited here')
    await expect(page.locator('.sbs-right .view-lines')).toContainText('shelved text')
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {[FILE]: 'shelved text\n'}, shelf: [entry('a', 'Tidy the sign-in', [[FILE2, 'second\n']])]})
    await expect(fileRow(page, FILE)).toHaveCount(0)
    // the whole entry
    await page.locator('#shelf .sh-entry .tn').click()
    await expect(unshelve).toHaveAttribute('aria-disabled', 'false')
    await unshelve.click()
    await expect(page.locator('#tree .tr-file.edited')).toHaveCount(2)
    await expect(page.locator('#shelf .tree-msg')).toContainText('Nothing shelved')
    await expect(page.locator('#stab-shelf-n')).toHaveText('')
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {[FILE]: 'shelved text\n', [FILE2]: 'second\n'}})
})

test('Unshelve is refused while the file has an edit: the current version shown is that edit', async ({page}) => {
    openPr(page.github)
    await seedEdits(page, {[FILE]: 'current edit\n'}, [entry('a', 'Older', [[FILE, 'shelved\n']])])
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await openShelf(page)
    await fileRow(page, FILE).click()
    await expect(page.locator('.sbs-right .view-lines')).toContainText('current edit')
    await expect(page.locator('.sbs-head-right .tag-ed')).toHaveText('with your edit')
    await expect(page.locator('#sh-unshelve')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('#sh-unshelve')).toHaveAttribute('title', /^CloudAuth\.ts has an edit now: commit it or roll it back first/)
    // a commit's changes are not where edits go
    await page.goto(`./?pr=${PR}&commit=${HEAD}`)
    await ready(page)
    await openShelf(page)
    await expect(page.locator('#sh-unshelve')).toHaveAttribute('title', /choose All commits/)
})

test('Delete takes a file or an entry off the Shelf, and Undo puts it back', async ({page}) => {
    openPr(page.github)
    const a = entry('a', 'First', [[FILE, 'one\n']]), b = entry('b', 'Second', [[FILE, 'two\n'], [FILE2, 'three\n']], DAY + 1000)
    await seedEdits(page, {}, [b, a])
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await openShelf(page)
    // newest first
    await expect(page.locator('#shelf .sh-entry .tn')).toHaveText(['Second', 'First'])
    await fileRow(page, FILE2, 'b').click()
    await expect(page.locator('.sbs-head-left')).toContainText('shelved')
    await page.locator('#sh-delete').click()
    await expect(fileRow(page, FILE2)).toHaveCount(0)
    // the file shown goes: the changed file shows again
    await expect(page.locator('#toolbar')).not.toHaveClass(/outside/)
    expect((await storedEdits(page)).shelf).toEqual([{...b, files: b.files.slice(0, 1)}, a])
    await page.locator('.toast-action', {hasText: 'Undo'}).click()
    await expect(fileRow(page, FILE2)).toHaveCount(1)
    expect((await storedEdits(page)).shelf).toEqual([b, a])
    await page.locator('#shelf .sh-entry[data-id="a"] .tn').click()
    await page.locator('#sh-delete').click()
    await expect(page.locator('#shelf .sh-entry .tn')).toHaveText(['Second'])
    await expect(page.locator('#toasts')).toContainText('Deleted “First” from the Shelf')
    await page.locator('.toast-action', {hasText: 'Undo'}).last().click()
    await expect(page.locator('#shelf .sh-entry .tn')).toHaveText(['Second', 'First'])
    expect((await storedEdits(page)).shelf).toEqual([b, a])
})

test('Copy and Download take a shelved file as it is, and an entry of several files as a .zip', async ({page}) => {
    openPr(page.github)
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (t) => { window.copied = t }}}))
    await seedEdits(page, {}, [entry('a', 'Two: files', [[FILE, 'one\n'], [FILE2, 'two\n']])])
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await openShelf(page)
    await expect(page.locator('#sh-copy')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('#sh-copy')).toHaveAttribute('title', 'Copy takes one file: select it')
    let download = page.waitForEvent('download')
    await page.locator('#sh-download').click()
    expect((await download).suggestedFilename()).toBe('Two- files.zip')
    const zip = unzipSync(fs.readFileSync(await (await download).path()))
    expect(Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, strFromU8(v)]))).toEqual({[FILE]: 'one\n', [FILE2]: 'two\n'})

    await fileRow(page, FILE2).click()
    await page.locator('#sh-copy').click()
    await expect.poll(() => page.evaluate(() => window.copied)).toBe('two\n')
    await expect(page.locator('#toasts')).toContainText('Copied the shelved auth.test.ts')
    download = page.waitForEvent('download')
    await page.locator('#sh-download').click()
    expect((await download).suggestedFilename()).toBe('auth.test.ts')
    expect(fs.readFileSync(await (await download).path(), 'utf8')).toBe('two\n')
})

test('Shelve Changes moves the checked edits to a new Shelf entry, named after the commit message, else the date', async ({page}) => {
    openPr(page.github)
    const older = entry('a', 'Older', [['CHANGELOG.md', 'x\n']])
    await seedEdits(page, {[FILE]: 'one\n', [FILE2]: 'two\n'}, [older])
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('.sbs-head-right .tag-ed')).toHaveText('edited here')
    await page.locator('#btn-commit').click()
    // unchecked, the second stays an edit
    await page.locator(`#cmt-tree .tr-file[data-file="${FILE2}"] .tvd`).click()
    await page.locator('#cmt-shelve').click()
    await expect(page.locator('#dialog')).toContainText(`Moves your edits of ${FILE} to the Shelf`)
    await expect(page.locator('#sv-name')).toHaveValue(/^Changes of \w+ \d+, \d{4}/)
    await page.locator('#sv-cancel').click()
    await page.locator('#cmt-msg').fill('Try the new expiry\n\nWith a reason.')
    await page.locator('#cmt-shelve').click()
    await expect(page.locator('#sv-name')).toHaveValue('Try the new expiry')
    await page.locator('#sv-go').click()
    await expect(page.locator('#toasts')).toContainText(`Shelved ${FILE}`)
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE2)
    // the file shows the head's version again
    await expect(page.locator('.sbs-head-right .tag-ed')).toHaveCount(0)
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {[FILE2]: 'two\n'}, shelf: [
        {id: expect.any(String), name: 'Try the new expiry', date: expect.any(Number), files: [{path: FILE, head: HEAD, text: 'one\n'}]}, older,
    ]})
    await page.locator('.toast-action', {hasText: 'Show'}).click()
    await expect(page.locator('#shelf .sh-entry .tn')).toHaveText(['Try the new expiry', 'Older'])
    await expect(page.locator('#shelf .sh-entry').first()).toHaveClass(/sel/)
    await expect(page.locator('#sh-unshelve')).toHaveAttribute('aria-disabled', 'false')
    // with nothing checked, nothing to shelve
    await page.locator('#stab-commit').click()
    await expect(page.locator('#cmt-shelve')).toBeDisabled()
})

test('the Shelf works in the drawer on a phone @phone', async ({page}) => {
    openPr(page.github)
    await seedEdits(page, {[FILE2]: 'an edit\n'}, [entry('a', 'Shelved here', [[FILE, 'shelved\n']])])
    await page.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await page.locator('#btn-commit').click()
    await expect(page.locator('body')).toHaveClass(/drawer-open/)
    await page.locator('#stab-shelf').click()
    await fileRow(page, FILE).click()
    await expect(page.locator('body')).not.toHaveClass(/drawer-open/)
    await expect(page.locator('#uni-left')).toContainText('shelved')
    await expect(page.locator('#uni-right')).toContainText('Current version')
})
