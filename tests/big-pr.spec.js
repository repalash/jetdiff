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
