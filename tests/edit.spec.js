import {test, expect, ready, recorded, PR, HEAD} from './fixture.js'

test.use({token: true})

const FILE = 'plugins/cloud/src/auth/CloudAuth.ts'
const NEW = 'c0ffee'.padEnd(40, '0')

test('edits a file, commits it to the pull request branch, and undoes the commit', async ({page}) => {
    const {github} = page
    const pr = recorded('/repos/repalash/threepipe/pulls/193')
    let head = HEAD
    github.alias[NEW] = HEAD
    github.handle(({method, path, body}) => {
        if (path === '/repos/repalash/threepipe/pulls/193') return {...pr, state: 'open', head: {...pr.head, sha: head}}
        if (method === 'GET' && path.includes('/git/ref/')) return {object: {sha: head}}
        if (method === 'GET' && path.includes('/git/commits/')) return {sha: head, tree: {sha: 'tree0'}, parents: [{sha: 'parent0'}], author: {name: 'A', email: 'a@example.com', date: '2026-01-01T00:00:00Z'}}
        if (method === 'GET' && path.includes('/git/trees/')) return {tree: [{path: 'CloudAuth.ts', mode: '100644', type: 'blob'}]}
        if (method === 'POST' && path.endsWith('/git/trees')) return {sha: 'tree1'}
        if (method === 'POST' && path.endsWith('/git/commits')) return {sha: NEW}
        if (method === 'PATCH') return (head = body.sha, {})
    })
    // Playwright's routes skip the HTTP cache: what can be checked is that every API request revalidates
    await page.addInitScript(() => {
        const fetch = window.fetch
        window.apiCache = []
        window.fetch = (input, init) => {
            if (String(input.url || input).startsWith('https://api.github.com/')) window.apiCache.push(init?.cache ?? input.cache)
            return fetch(input, init)
        }
    })
    await page.goto(`./?pr=${PR}&file=${FILE}`)
    await ready(page)
    await page.locator('#btn-edit').click()
    await page.locator('.sbs-right .view-line').nth(3).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' // edited')
    await expect(page.locator('#btn-commit')).toBeVisible()
    await expect(page.locator('#tree .tr-file.edited')).toHaveAttribute('data-file', FILE)

    await page.locator('#btn-commit').click()
    await page.locator('#cmt-msg').fill('Fix the sign-in check')
    await page.locator('#cmt-go').click()
    await expect(page.locator('#toasts')).toContainText('Committed c0ffee0')
    const posts = github.writes.filter((w) => w.method !== 'GET' && w.path !== '/graphql')
    expect(posts.map((w) => `${w.method} ${w.path}`)).toEqual([
        'POST /repos/repalash/threepipe/git/trees',
        'POST /repos/repalash/threepipe/git/commits',
        `PATCH /repos/repalash/threepipe/git/refs/heads/${pr.head.ref}`,
    ])
    expect(posts[0].body.base_tree).toBe('tree0')
    expect(posts[0].body.tree).toEqual([expect.objectContaining({path: FILE, content: expect.stringContaining('// edited')})])
    expect(posts[1].body).toMatchObject({message: 'Fix the sign-in check', parents: [HEAD]})
    expect(posts[2].body).toEqual({sha: NEW, force: false})
    await expect(page.locator('#btn-commit')).toBeHidden()

    github.writes.length = 0
    await page.locator('.toast-action', {hasText: 'Undo'}).click()
    await expect(page.locator('#btn-commit')).toBeVisible()
    expect(github.writes.filter((w) => w.method === 'PATCH').map((w) => w.body)).toEqual([{sha: HEAD, force: true}])
    const modes = await page.evaluate(() => window.apiCache)
    expect(modes.length).toBeGreaterThan(10)
    expect(modes.filter((m) => m !== 'no-cache')).toEqual([])
})
