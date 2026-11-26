import {test, expect, ready, fakePr} from './fixture.js'

// Next and Previous Difference (F7, Shift+F7, the toolbar's arrows), as in the IDE's diff
const lines = (n, f = (i) => `line ${i}`) => Array.from({length: n}, (_, i) => f(i + 1)).join('\n') + '\n'
const changedAt = (...at) => lines(200, (i) => at.includes(i) ? `changed ${i}` : `line ${i}`)
let number = 9200

/** a.ts changed at lines 40 and 90, b.ts at 30 and 150; opens `file`. */
async function twoFiles(page, file, extra = '') {
    const pr = fakePr(page.github, ++number, [
        {filename: 'a.ts', old: lines(200), new: changedAt(40, 90)},
        {filename: 'b.ts', old: lines(200), new: changedAt(30, 150)},
    ])
    await page.goto(`${pr.url}&file=${file}${extra}`)
    await ready(page)
}

const tip = (page) => page.locator('.tip-point')
const fileParam = (page) => new URL(page.url()).searchParams.get('file')

for (const [view, editor] of [['sbs', '.sbs-right'], ['unified', '.editor.modified']]) {
    test(`a step puts the caret at column 1 of the change, focused, in the middle of the view (${view})`, async ({page}) => {
        await page.addInitScript((v) => localStorage.setItem('jd.view', JSON.stringify(v)), view)
        await twoFiles(page, 'a.ts')
        await page.keyboard.press('F7')
        await expect(page.locator('#st-pos')).toHaveText('Difference 2 of 2')
        const ed = page.locator(editor)
        await expect(ed.locator('textarea')).toBeFocused()
        const line = await ed.locator('.view-line', {hasText: 'changed 90'}).boundingBox()
        const caret = await ed.locator('.cursor').boundingBox()
        const view_ = await ed.locator('.monaco-scrollable-element').first().boundingBox()
        expect(Math.abs(caret.y - line.y)).toBeLessThan(2)
        expect(Math.abs(caret.x - line.x)).toBeLessThan(3)
        expect(Math.abs(line.y + line.height / 2 - (view_.y + view_.height / 2))).toBeLessThan(line.height)
    })
}

test('at the last change, a press shows a tip and stays; the next opens the next file at its first change', async ({page}) => {
    await twoFiles(page, 'a.ts')
    await page.keyboard.press('F7')
    await page.keyboard.press('F7')
    await expect(tip(page)).toHaveText('Press again to go to the next file')
    expect(fileParam(page)).toBe('a.ts')
    await expect(page.locator('#st-pos')).toHaveText('Difference 2 of 2')
    // the toolbar's button is the same press
    await page.locator('#btn-next-diff').click()
    await expect(tip(page)).toHaveCount(0)
    await expect(page.locator('#tree .tr-file.sel')).toHaveAttribute('data-file', 'b.ts')
    await ready(page)
    await expect(page.locator('#st-pos')).toHaveText('Difference 1 of 2')
    await expect(page.locator('.sbs-right textarea')).toBeFocused()
})

for (const view of ['sbs', 'unified']) {
    test(`Shift+F7 back into the previous file lands on its last change (${view})`, async ({page}) => {
        await page.addInitScript((v) => localStorage.setItem('jd.view', JSON.stringify(v)), view)
        await twoFiles(page, 'b.ts')
        await page.keyboard.press('Shift+F7')
        await expect(tip(page)).toHaveText('Press again to go to the previous file')
        await page.keyboard.press('Shift+F7')
        await expect(page.locator('#tree .tr-file.sel')).toHaveAttribute('data-file', 'a.ts')
        await ready(page)
        await expect(page.locator('#st-pos')).toHaveText('Difference 2 of 2')
    })
}

test('another action between the two presses ends the offer', async ({page}) => {
    await twoFiles(page, 'a.ts')
    await page.keyboard.press('F7')
    await page.keyboard.press('F7')
    await expect(tip(page)).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(tip(page)).toHaveCount(0)
    await page.keyboard.press('F7')
    await expect(tip(page)).toHaveText('Press again to go to the next file')
    expect(fileParam(page)).toBe('a.ts')
})

test('past the last change of the last file, a step says there are no more', async ({page}) => {
    await twoFiles(page, 'b.ts')
    await page.keyboard.press('F7')
    await page.keyboard.press('F7')
    await expect(tip(page)).toHaveText('No more differences')
    await page.keyboard.press('F7')
    await expect(tip(page)).toHaveText('No more differences')
    expect(fileParam(page)).toBe('b.ts')
})

test.describe('while editing', () => {
    test.use({token: true})
    test('a step onto a removed block keeps the caret in the editable side, where the block was', async ({page}) => {
        const old = lines(200)
        const pr = fakePr(page.github, ++number, [{filename: 'c.ts', old, new: old.split('\n').filter((l, i) => i < 59 || i > 61).join('\n')}])
        await page.goto(`${pr.url}&file=c.ts`)
        await ready(page)
        await page.locator('#btn-edit').click()
        await page.locator('.sbs-right .view-line').first().click()
        await page.keyboard.press('Control+Home')
        await page.keyboard.press('F7')
        await expect(page.locator('.sbs-right textarea')).toBeFocused()
        expect(await page.evaluate(() => window.monaco.editor.getEditors().find((e) => e.hasTextFocus()).getPosition())).toEqual({lineNumber: 60, column: 1})
    })
})
