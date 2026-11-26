import fs from 'node:fs'
import {test, expect, ready, recorded, fakePr, FIXTURE_DIR, PR, HEAD} from './fixture.js'

test.use({token: true})

const R = '/repos/repalash/threepipe'
const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const FILE2 = 'plugins/cloud/tests/auth.test.ts'
const NEW = 'c0ffee'.padEnd(40, '0')
const OLD = 'beef'.padEnd(40, '0')
const KEY = 'repalash/threepipe#193'
const pr = recorded(`${R}/pulls/193`)
const AUTHOR = {name: 'Original Author', email: 'original@example.com', date: '2026-01-01T00:00:00Z'}

/**
 * The PR's branch on GitHub, at `ref`. `prHead`, when set, is the PR's head as GitHub shows it: it follows a push a
 * moment later. NEW (the commit made) and OLD read as the fixture's head.
 */
function branch(github) {
    const b = {ref: HEAD, prHead: null, mode: '100644', type: 'blob', message: 'Message of the head commit'}
    github.alias[NEW] = HEAD
    github.alias[OLD] = HEAD
    github.handle(({method, path, body}) => {
        if (path === `${R}/pulls/193`) return {...pr, state: 'open', head: {...pr.head, sha: b.prHead ?? b.ref}}
        if (method === 'GET' && path.includes('/git/ref/')) return {object: {sha: b.ref}}
        if (method === 'GET' && path.includes('/git/commits/')) return {sha: b.ref, message: b.message, author: AUTHOR, tree: {sha: 'tree0'}, parents: [{sha: 'parent0'}]}
        if (method === 'GET' && path.includes('/git/trees/')) return {tree: [{path: 'CloudAuth.ts', mode: b.mode, type: b.type}]}
        if (method === 'POST' && path.endsWith('/git/trees')) return {sha: 'tree1'}
        if (method === 'POST' && path.endsWith('/git/commits')) return {sha: NEW}
        if (method === 'PATCH') return (b.ref = body.sha, {})
    })
    return b
}

const posts = (github) => github.writes.filter((w) => w.method === 'POST' && w.path !== '/graphql')

async function edit(page, text = ' // edited') {
    await page.locator('#btn-edit').click()
    await page.locator('.sbs-right .view-line').nth(3).click()
    await page.keyboard.press('End')
    await page.keyboard.type(text)
}

async function commit(page, message = 'Fix the sign-in check') {
    await page.locator('#btn-commit').click()
    await page.locator('#cmt-msg').fill(message)
    await page.locator('#cmt-go').click()
}

const seed = (key, value) => ({key, value: JSON.stringify(value)})
/** Puts `value` in the page's storage under `key` before the first load only. */
const seedOnce = (page, ...items) => page.addInitScript((items) => {
    for (const {key, value} of items) if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
}, items)

const storedEdits = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('jd.edits') || '{}')[k], KEY)

test('Undo while the commit waits for GitHub keeps the restored edits', async ({page}) => {
    const {github} = page
    const b = branch(github)
    b.prHead = HEAD
    const atCommit = []
    github.handle(({method, path}) => { if (method === 'GET' && path.includes(`ref=${NEW}`)) atCommit.push(path) })
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await commit(page)
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    await page.locator('.toast-action', {hasText: 'Undo'}).click()
    await expect.poll(() => b.ref).toBe(HEAD)
    // GitHub shows the commit's push after the undo's: the commit's reload must not load it
    b.prHead = NEW
    await page.waitForTimeout(2500)
    b.prHead = HEAD
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE)
    await page.waitForTimeout(1600)
    expect(atCommit).toEqual([])
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE)
    expect(Object.keys((await storedEdits(page)).files)).toEqual([FILE])
})

test('Commit is off while a reload carries the edits over to a new head', async ({page}) => {
    const {github} = page
    const b = branch(github)
    b.ref = OLD
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await page.locator('#btn-commit').click()
    await page.locator('#cmt-msg').fill('Fix')
    b.ref = HEAD
    let release
    const held = new Promise((r) => { release = r })
    let reached
    const atHead = new Promise((r) => { reached = r })
    await page.route(`**/contents/**ref=${HEAD}`, async (route) => {
        if (route.request().method() !== 'OPTIONS') { reached(); await held }
        await route.fallback()
    })
    await page.locator('#strip-changes').click()
    await page.locator('#btn-reload').click()
    await atHead
    await page.locator('#strip-commit').click()
    await expect(page.locator('#cmt-go')).toBeDisabled()
    await page.locator('#cmt-msg').press('Control+Enter')
    await page.waitForTimeout(300)
    expect(posts(github)).toEqual([])
    release()
    await expect(page.locator('#cmt-go')).toBeEnabled()
    await page.locator('#cmt-go').click()
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    expect(posts(github)[1].body.parents).toEqual([HEAD])
})

test('an edit made on an older head is kept when a read fails, and carried over on the next load', async ({page}) => {
    branch(page.github)
    await seedOnce(page, seed('jd.edits', {[KEY]: {head: OLD, files: {[FILE]: 'my edit\n'}}}))
    await page.route(`**/contents/**ref=${OLD}`, (route) => route.fulfill({status: 502, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}, body: '{}'}))
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('#tree .tr-file.edited')).toHaveCount(0)
    await expect(page.locator('#toasts')).not.toContainText('Dropped')
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {}, pending: [{path: FILE, head: OLD, text: 'my edit\n'}]})
    await page.unrouteAll()
    await page.reload()
    await ready(page)
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE)
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {[FILE]: 'my edit\n'}})
})

test('two tabs of a pull request keep each other\'s edits', async ({page, context}) => {
    branch(page.github)
    const other = await context.newPage()
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await other.goto(`./?pr=${PR}&file=${FILE2}`)
    await ready(page)
    await ready(other)
    const stored = async () => Object.keys((await storedEdits(page))?.files || {}).sort()
    await edit(page)
    await expect.poll(stored).toEqual([FILE])
    // written where this tab gets no storage event: its next save keeps it
    await page.evaluate(([k, f]) => {
        const all = JSON.parse(localStorage.getItem('jd.edits'))
        all[k].files[f] = 'elsewhere\n'
        localStorage.setItem('jd.edits', JSON.stringify(all))
    }, [KEY, 'CHANGELOG.md'])
    await page.keyboard.type('!')
    await expect.poll(async () => (await storedEdits(page)).files[FILE]).toContain('// edited!')
    expect(await stored()).toEqual(['CHANGELOG.md', FILE])
    // the other tab's edit reaches this one
    await edit(other, ' // other tab')
    await expect.poll(stored).toEqual(['CHANGELOG.md', FILE, FILE2])
    await expect(page.locator('#tree .tr-file.edited')).toHaveCount(3)
    await page.keyboard.type('?')
    await expect.poll(async () => (await storedEdits(page)).files[FILE]).toContain('// edited!?')
    expect(await stored()).toEqual(['CHANGELOG.md', FILE, FILE2])
    await other.close()
})

test('a commit keeps the file\'s BOM, and typing an edit back leaves no edit', async ({page}) => {
    const {github} = page
    branch(github)
    const text = fs.readFileSync(new URL(JSON.parse(fs.readFileSync(new URL('index.json', FIXTURE_DIR)))[`${R}/contents/${FILE}?ref=${HEAD}`].file, FIXTURE_DIR), 'utf8')
    await page.route(`**/contents/**ref=${HEAD}`, (route) => {
        if (!route.request().url().includes(FILE) || route.request().method() === 'OPTIONS') return route.fallback()
        route.fulfill({headers: {'access-control-allow-origin': '*'}, body: Buffer.from('﻿' + text)})
    })
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page, 'x')
    await expect(page.locator('#btn-commit')).toBeVisible()
    await page.keyboard.press('Backspace')
    await expect(page.locator('#btn-commit')).toBeHidden()
    await page.keyboard.type(' // edited')
    await commit(page)
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    const content = posts(github)[0].body.tree[0].content
    expect(content.startsWith('﻿')).toBe(true)
    expect(content).toContain('// edited')
})

test('a file that is not UTF-8 or has mixed line endings opens read-only; other files stay editable', async ({page}) => {
    const {github} = page
    const pr = fakePr(github, 9010, [
        {filename: 'latin1.txt', old: 'cafe\n', new: Buffer.from('caf\xe9\n', 'latin1')},
        {filename: 'mixed.txt', old: 'a\nb\n', new: 'a\r\nb\nc\n'},
        {filename: 'plain.txt', old: 'a\n', new: 'b\n'},
    ])
    for (const [file, why] of [['latin1.txt', 'not UTF-8'], ['mixed.txt', 'mixed line endings']]) {
        await page.goto(`${pr.url}&file=${file}`)
        await ready(page)
        await expect(page.locator('.sbs-head-right .tag-ro')).toHaveText(`read-only: ${why}`)
        await expect(page.locator('#btn-edit')).toBeHidden()
    }
    await page.goto(`${pr.url}&file=plain.txt`)
    await ready(page)
    await expect(page.locator('#btn-edit')).toBeVisible()
})

test('Amend keeps the commit\'s author and date; its committer is the saved one, else the token\'s account', async ({page}) => {
    const {github} = page
    const b = branch(github)
    github.handle(({method, path}) => method === 'GET' && path === '/user' && {login: 'me', id: 7, name: null, email: null})
    await page.goto('./')
    const amend = (author) => page.evaluate(([author, head]) => import('/js/github.js').then((m) => m.commitFiles({
        owner: 'repalash', repo: 'threepipe', branch: 'b', expectedHead: head, files: [], message: 'm', amend: true, author})), [author, b.ref])
    const saved = {name: 'Saved', email: 'saved@example.com'}
    await amend(saved)
    await amend(null)
    expect(posts(github).filter((w) => w.path.endsWith('/git/commits')).map((w) => [w.body.author, w.body.committer])).toEqual([
        [AUTHOR, saved],
        [AUTHOR, {name: 'me', email: '7+me@users.noreply.github.com'}],
    ])
})

test('an edit of a file that changed on GitHub since is kept aside, to copy, download or discard', async ({page}) => {
    const {github} = page
    branch(github)
    github.handle(({method, path}) => method === 'GET' && path.includes('/contents/') && path.endsWith(`ref=${OLD}`) && {raw: 'the file before\n'})
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (t) => { window.copied = t }}}))
    await seedOnce(page, seed('jd.edits', {[KEY]: {head: OLD, files: {[FILE]: 'my edit\n'}}}))
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await expect(page.locator('#tree .tr-file.edited')).toHaveCount(0)
    expect(await storedEdits(page)).toEqual({head: HEAD, files: {}, conflicts: [{path: FILE, head: OLD, text: 'my edit\n'}]})
    await page.locator('.toast-action', {hasText: 'Show'}).click()
    const row = page.locator('#dialog .off-row', {hasText: FILE})
    await row.locator('[data-copy]').click()
    await expect.poll(() => page.evaluate(() => window.copied)).toBe('my edit\n')
    const download = page.waitForEvent('download')
    await row.locator('[data-download]').click()
    expect((await download).suggestedFilename()).toBe('CloudAuth.ts')
    expect(fs.readFileSync(await (await download).path(), 'utf8')).toBe('my edit\n')
    await page.locator('#cf-close').click()
    await page.locator('#strip-commit').click()
    await page.locator('#cmt-aside', {hasText: '1 edit kept aside'}).click()
    page.once('dialog', (d) => d.accept())
    await row.locator('[data-discard]').click()
    await expect(page.locator('#dialog')).toBeHidden()
    await expect(page.locator('#cmt-aside')).toBeHidden()
    expect(await storedEdits(page)).toBeUndefined()
})

test('an older edit replaced by a newer edit of the same file is kept aside, not dropped', async ({page}) => {
    page.github.alias[OLD] = HEAD
    await seedOnce(page, seed('jd.edits', {[KEY]: {head: HEAD, files: {[FILE]: 'newer\n'}, pending: [{path: FILE, head: OLD, text: 'older\n'}]}}))
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    expect(await storedEdits(page)).toMatchObject({head: HEAD, files: {[FILE]: 'newer\n'}, conflicts: [{path: FILE, head: OLD, text: 'older\n'}]})
    await expect(page.locator('#toasts')).toContainText('older edits of')
})

test('a push whose answer is lost is seen as made', async ({page}) => {
    const b = branch(page.github)
    await page.route('**/git/refs/**', (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        b.ref = route.request().postDataJSON().sha
        route.abort('connectionreset')
    })
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await commit(page)
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    await expect(page.locator('#cmt-err')).toBeHidden()
})

test('each file keeps its mode, and a file that is not a regular one is not committed', async ({page}) => {
    const {github} = page
    const b = branch(github)
    b.mode = '160000'
    b.type = 'commit'
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await commit(page)
    await expect(page.locator('#cmt-err')).toContainText(`${FILE} is not a regular file (mode 160000)`)
    expect(posts(github)).toEqual([])
    expect(github.writes.map((w) => w.path)).toContain(`${R}/git/trees/${encodeURIComponent(`${HEAD}:plugins/cloud/src/auth`)}`)
    b.mode = '100755'
    b.type = 'blob'
    await page.locator('#cmt-go').click()
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    expect(posts(github)[0].body.tree).toEqual([expect.objectContaining({path: FILE, mode: '100755'})])
})

test('Amend brings the message of the head commit', async ({page}) => {
    branch(page.github)
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await page.locator('#btn-commit').click()
    await page.locator('#cmt-msg').fill('typed')
    await page.locator('#cmt-amend').check()
    await expect(page.locator('#cmt-msg')).toHaveValue('Message of the head commit')
    await page.locator('#cmt-amend').uncheck()
    await expect(page.locator('#cmt-msg')).toHaveValue('typed')
})

test('edits that cannot be saved on the device say so', async ({page}) => {
    branch(page.github)
    await page.addInitScript(() => {
        const set = Storage.prototype.setItem
        Storage.prototype.setItem = function (k, v) {
            if (k === 'jd.edits') throw new DOMException('full', 'QuotaExceededError')
            return set.call(this, k, v)
        }
    })
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await edit(page)
    await expect(page.locator('#toasts')).toContainText('could not be saved on this device')
})

test('Viewed marks queued offline stay queued until GitHub has them', async ({page}) => {
    const {github} = page
    branch(github)
    let fail = true
    const marked = []
    github.handle(({path, body}) => {
        if (path !== '/graphql') return
        if (body.query.includes('viewerViewedState')) return {data: {repository: {pullRequest: {id: 'PR_1', files: {pageInfo: {hasNextPage: false},
            nodes: [{path: FILE, viewerViewedState: 'VIEWED'}, {path: FILE2, viewerViewedState: 'UNVIEWED'}]}}}}}
        marked.push(body.variables.p)
        return fail ? {errors: [{message: 'Something went wrong'}]} : {data: {markFileAsViewed: {clientMutationId: null}}}
    })
    const key = 'jd.viewed.repalash/threepipe/#193.pending'
    await seedOnce(page, seed(key, {[FILE]: true, [FILE2]: true}))
    const queued = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key)
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    // the first is viewed on GitHub already; the second's mark fails
    await expect.poll(() => marked).toEqual([FILE2])
    await expect.poll(queued).toEqual({[FILE2]: true})
    fail = false
    await page.reload()
    await ready(page)
    await expect.poll(queued).toEqual({})
    expect(marked).toEqual([FILE2, FILE2])
})
