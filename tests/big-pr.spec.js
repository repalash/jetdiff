import {test, expect, ready, fakePr} from './fixture.js'

// Big pull requests: memory across files, the tree, huge files, partial data, the API budget and failures
const lines = (n, f = (i) => `export const v${i} = ${i}`) => Array.from({length: n}, (_, i) => f(i + 1)).join('\n') + '\n'
const changed = (n, every = 37) => lines(n, (i) => i % every === 5 ? `export const v${i} = '${i} changed'` : `export const v${i} = ${i}`)
let number = 9400

/** The live text models, disposed or not, after a garbage collection: what the page still holds of the files it showed. */
async function liveModels(page) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('HeapProfiler.collectGarbage')
    const {result: proto} = await cdp.send('Runtime.evaluate', {expression: 'Object.getPrototypeOf(monaco.editor.getModels()[0])'})
    const {objects} = await cdp.send('Runtime.queryObjects', {prototypeObjectId: proto.objectId})
    const {result} = await cdp.send('Runtime.callFunctionOn', {objectId: objects.objectId, functionDeclaration: 'function () { return this.length }', returnByValue: true})
    await cdp.detach()
    return result.value
}

for (const view of ['sbs', 'unified']) {
    test(`the files shown before are freed: models stay few over many files (${view})`, async ({page}) => {
        test.setTimeout(120000)
        await page.addInitScript((v) => localStorage.setItem('jd.view', JSON.stringify(v)), view)
        const files = Array.from({length: 32}, (_, i) => ({filename: `src/f${String(i).padStart(2, '0')}.ts`, old: lines(300), new: changed(300)}))
        const pr = fakePr(page.github, ++number, files)
        await page.goto(pr.url)
        await ready(page)
        const start = await liveModels(page)
        for (let i = 0; i < 30; i++) {
            await page.locator('#btn-next-file').click()
            await ready(page)
        }
        expect(await page.evaluate(() => monaco.editor.getModels().length)).toBe(2)
        // the open file's two, the next file's prefetch aside: a few more at most, not two per file shown
        expect(await liveModels(page) - start).toBeLessThan(6)
    })
}

/** Holds the GitHub requests `match` takes (a URL) until `release()`; `seen` counts them. */
async function gate(page, match) {
    let open
    const opened = new Promise((r) => { open = r })
    const g = {seen: 0, release: () => open()}
    await page.route((u) => u.hostname === 'api.github.com' && match(u), async (route) => {
        g.seen++
        await opened
        await route.fallback().catch(() => {})
    })
    return g
}

/** Opens another view of the page in place, as a link in it does. */
const goTo = (page, url) => page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')) }, url)

test('switching to another pull request while a file loads never shows the first one\'s file', async ({page}) => {
    const a = fakePr(page.github, ++number, [{filename: 'a.ts', old: 'old a\n', new: 'new a\n'}])
    const b = fakePr(page.github, ++number, [])
    const held = await gate(page, (u) => u.pathname.endsWith('/contents/a.ts') && u.search.includes(a.head))
    await page.goto(a.url)
    await expect(page.locator('#tree .tr-file')).toHaveCount(1)
    await expect.poll(() => held.seen).toBe(1)
    await goTo(page, b.url)
    await expect(page.locator('#view-msg')).toContainText('No changed files')
    held.release()
    // the first file's load ends after the switch
    await page.waitForTimeout(500)
    await expect(page.locator('#view-msg')).toHaveClass(/\bactive\b/)
    await expect(page.locator('#view-msg')).toContainText('No changed files')
    await expect(page.locator('.view-lines', {hasText: 'new a'})).toHaveCount(0)
})

test.describe('a request GitHub does not answer', () => {
    // the page's timers run on Playwright's clock: 30 s pass at once
    test.beforeEach(({page}) => page.clock.install())
    const stall = (page) => page.clock.fastForward(31000)

    test('stops the file\'s load: a message says so, and Retry loads it', async ({page}) => {
        const pr = fakePr(page.github, ++number, [{filename: 'a.ts', old: 'old a\n', new: 'new a\n'}])
        const held = await gate(page, (u) => u.pathname.endsWith('/contents/a.ts') && u.search.includes(pr.head))
        await page.goto(pr.url)
        await expect.poll(() => held.seen).toBe(1)
        await stall(page)
        await expect(page.locator('#view-msg')).toContainText('Could not load a.ts')
        await expect(page.locator('#view-msg')).toContainText('GitHub did not answer for 30 seconds')
        await expect(page.locator('#loading-bar')).not.toHaveClass(/\bon\b/)
        held.release()
        await page.locator('#view-msg .retry').click()
        await ready(page)
        await expect(page.locator('.sbs-right .view-lines')).toContainText('new a')
    })

    test('stops the change set\'s load: the start page says so, and Retry opens it', async ({page}) => {
        const pr = fakePr(page.github, ++number, [{filename: 'a.ts', old: 'old a\n', new: 'new a\n'}])
        const held = await gate(page, (u) => u.pathname === `/repos/repalash/threepipe/pulls/${number}`)
        await page.goto(pr.url)
        await expect.poll(() => held.seen).toBe(1)
        await stall(page)
        await expect(page.locator('#land-error')).toContainText(`Could not open repalash/threepipe#${number}`)
        await expect(page.locator('#land-error')).toContainText('GitHub did not answer for 30 seconds')
        held.release()
        await page.locator('#land-error .retry').click()
        await ready(page)
        await expect(page.locator('#tree .tr-file')).toHaveCount(1)
    })

    test('stops the Timeline\'s load: it says so, and Retry loads it', async ({page}) => {
        const pr = fakePr(page.github, ++number, [{filename: 'a.ts', old: 'old a\n', new: 'new a\n'}])
        page.github.handle(({path}) => path.startsWith(`/repos/repalash/threepipe/issues/${number}`) || path.includes(`/pulls/${number}/reviews`)
            || path.includes(`/pulls/${number}/comments`) ? [] : undefined)
        const held = await gate(page, (u) => u.pathname.endsWith(`/issues/${number}/comments`))
        await page.goto(pr.url)
        await ready(page)
        await page.locator('#pr-timeline').click()
        await expect.poll(() => held.seen).toBe(1)
        await stall(page)
        await expect(page.locator('#timeline-host')).toContainText('Could not load the conversation')
        await expect(page.locator('#timeline-host')).toContainText('GitHub did not answer for 30 seconds')
        held.release()
        await page.locator('#timeline-host .retry').click()
        await expect(page.locator('.tl-desc')).toBeVisible()
    })
})

/** The paths of the requests to GitHub the page makes from now on. */
function githubRequests(page) {
    const paths = []
    page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname === 'api.github.com' && r.method() === 'GET') paths.push(u.pathname + u.search) })
    return paths
}

test('the Log reads the selected commit\'s files when it is first shown, not before', async ({page}) => {
    const pr = fakePr(page.github, ++number, [{filename: 'a.ts', old: 'old a\n', new: 'new a\n'}])
    const paths = githubRequests(page)
    await page.goto(pr.url)
    await ready(page)
    const commitFiles = () => paths.filter((p) => p.includes(`/commits/${pr.head}`))
    expect(commitFiles()).toEqual([])
    await page.locator('#tab-log').click()
    await expect(page.locator('#log-tree .tr-file')).toHaveCount(1)
    expect(commitFiles()).toHaveLength(1)
})

/** `n` files in `dirs` folders, each a one-line change. */
const manyFiles = (n, dirs = 30) => Array.from({length: n}, (_, i) => ({filename: `pkg/d${String(i % dirs).padStart(2, '0')}/f${String(i).padStart(4, '0')}.txt`,
    old: 'a\n', new: 'b\n'}))

/** Counts the nodes the tree removes while `fn` runs: none when it updates its rows in place. */
async function treeNodesRemoved(page, fn) {
    await page.evaluate(() => {
        window.jdRemoved = 0
        window.jdTreeObserver = new MutationObserver((ms) => { for (const m of ms) window.jdRemoved += m.removedNodes.length })
        window.jdTreeObserver.observe(document.querySelector('#tree'), {childList: true, subtree: true})
    })
    await fn()
    return page.evaluate(() => { window.jdTreeObserver.disconnect(); return window.jdRemoved })
}

test('a step to the next file or a Viewed mark updates the rows it changes, not the whole tree', async ({page}) => {
    test.setTimeout(120000)
    const pr = fakePr(page.github, ++number, manyFiles(3000))
    await page.goto(pr.url)
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(3000)
    const first = await page.locator('#tree .tr-file.sel').getAttribute('data-file')
    const removed = await treeNodesRemoved(page, async () => {
        await page.locator('#btn-next-file').click()
        await ready(page)
        await expect(page.locator('#tree .tr-file.sel')).not.toHaveAttribute('data-file', first)
        await page.keyboard.press('v')
        await expect(page.locator('#tree .tr-file.sel')).toHaveClass(/\bviewed\b/)
        await expect(page.locator('#viewed-count')).toHaveText('1 / 3000 viewed')
    })
    await expect(page.locator('#tree .tr-file.sel')).toHaveCount(1)
    await expect(page.locator(`#tree .tr-file[data-file="${first}"]`)).not.toHaveClass(/\bsel\b/)
    // the Viewed box of the file marked, at most
    expect(removed).toBeLessThan(5)
    // a file in a collapsed folder still shows once selected
    await page.locator('#btn-collapse').click()
    await expect(page.locator('#tree .tr-file')).toHaveCount(0)
    await page.locator('#btn-next-file').click()
    await ready(page)
    await expect(page.locator('#tree .tr-file.sel')).toBeVisible()
})

test('a load another one replaced stops: no more pages of the files of a pull request switched away from', async ({page}) => {
    const a = fakePr(page.github, ++number, manyFiles(3000))
    const b = fakePr(page.github, ++number, [{filename: 'b.ts', old: 'old b\n', new: 'new b\n'}])
    const pagesOfA = () => paths.filter((p) => p.startsWith(`/repos/repalash/threepipe/pulls/${number - 1}/files?`))
    const held = await gate(page, (u) => u.pathname.endsWith(`/pulls/${number - 1}/files`) && u.search.includes('page=2'))
    const paths = githubRequests(page)
    await page.goto(a.url)
    await expect.poll(() => held.seen).toBe(1)
    await goTo(page, b.url)
    await ready(page)
    held.release()
    await page.waitForTimeout(1000)
    // GitHub lists them 100 a page: pages 3 to 30 are never asked for
    expect(pagesOfA()).toHaveLength(2)
})

test('a file\'s load stops when another file opens, but a load the new one shares goes on', async ({page}) => {
    const files = ['a', 'b', 'c', 'd'].map((n) => ({filename: `${n}.ts`, old: `old ${n}\n`, new: `new ${n}\n`}))
    const pr = fakePr(page.github, ++number, files)
    const failed = []
    page.on('requestfailed', (r) => failed.push(new URL(r.url()).pathname))
    const heldB = await gate(page, (u) => u.pathname.endsWith('/contents/b.ts') && u.search.includes(pr.head))
    const heldC = await gate(page, (u) => u.pathname.endsWith('/contents/c.ts') && u.search.includes(pr.head))
    await page.goto(`${pr.url}&file=a.ts`)
    await ready(page)
    // the next file is read ahead
    await expect.poll(() => heldB.seen).toBe(1)
    // b.ts opens: it waits on the read ahead, which goes on
    await page.locator('#tree .tr-file[data-file="b.ts"]').click()
    await page.waitForTimeout(300)
    expect(failed).toEqual([])
    // c.ts opens before b.ts arrived: b.ts is no longer waited for
    await page.locator('#tree .tr-file[data-file="c.ts"]').click()
    await expect.poll(() => failed).toEqual(['/repos/repalash/threepipe/contents/b.ts'])
    heldB.release()
    heldC.release()
    await ready(page)
    await expect(page.locator('.sbs-right .view-lines')).toContainText('new c')
})
