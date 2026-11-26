import {test, expect, ready, fakePr} from './fixture.js'

const R = '/repos/repalash/threepipe'

/** The focused editor's file (its model's path) and caret. */
const caret = (page) => page.evaluate(() => {
    const ed = window.monaco.editor.getEditors().find((e) => e.hasTextFocus())
    const p = ed?.getPosition()
    return ed && `${ed.getModel().uri.path.slice(1)}:${p.lineNumber}:${p.column}`
})

/** The name `word` on the line that has `line` in the editor `side` ('.sbs-right', '#file-ed'…). */
const nameIn = (page, side, line, word) => page.locator(`${side} .view-line`, {hasText: line}).locator('span span', {hasText: word}).first()

const MAIN = {filename: 'app/main.py', old: 'from util import helper\n\nprint(helper(1))\n', new: 'from util import helper\n\nprint(helper(2))\nprint(compute(3), missing)\n'}
const UTIL = {filename: 'app/util.py', old: 'def helper(x):\n    return x\n', new: 'def helper(x):\n    return x + 1\n'}

test('Ctrl-click goes to the one declaration in the changed files, and Ctrl+Alt+← comes back', async ({page}) => {
    const {url} = fakePr(page.github, 911, [MAIN, UTIL])
    await page.goto(`${url}&file=app/main.py`)
    await ready(page)
    const name = nameIn(page, '.sbs-right', 'print(helper', 'helper')
    await page.keyboard.down('Control')
    await name.hover()
    await expect(page.locator('.sbs-right .jd-goto')).toHaveText('helper')
    await name.click()
    await page.keyboard.up('Control')
    await expect.poll(() => caret(page)).toBe('app/util.py:1:5')
    await expect(page.locator('#tree .tr-file.sel')).toHaveAttribute('data-file', 'app/util.py')
    await page.keyboard.press('Control+Alt+ArrowLeft')
    await expect.poll(() => caret(page)).toMatch(/^app\/main\.py:3:\d+$/)
})

test('several declarations show a list to choose from', async ({page}) => {
    const {url} = fakePr(page.github, 912, [MAIN, UTIL, {filename: 'app/other.py', status: 'added', new: 'import os\n\ndef helper(y):\n    pass\n'}])
    await page.goto(`${url}&file=app/main.py`)
    await ready(page)
    // the underline follows Ctrl in an editor without the focus too, and a click there afterwards places the caret
    const name = nameIn(page, '.sbs-right', 'print(helper', 'helper')
    await page.keyboard.down('Control')
    await name.hover()
    await expect(page.locator('.sbs-right .jd-goto')).toHaveText('helper')
    await page.keyboard.up('Control')
    await expect(page.locator('.sbs-right .jd-goto')).toHaveCount(0)
    await name.click()
    await page.keyboard.press('Control+B')
    const items = page.locator('.decl .decl-item')
    await expect(items.locator('.decl-text')).toHaveText(['def helper(y):', 'def helper(x):'])
    await expect(items.locator('.decl-where')).toHaveText(['other.py:3', 'util.py:1'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.locator('.decl')).toHaveCount(0)
    await expect.poll(() => caret(page)).toBe('app/util.py:1:5')
})

test.describe('with a token', () => {
    test.use({token: true})
    test('a name declared outside the changes is found by GitHub\'s code search, until its rate limit', async ({page}) => {
        const {github} = page
        const {url, head} = fakePr(github, 913, [MAIN, UTIL])
        let limited = false
        github.handle(({path}) => {
            if (path.startsWith('/search/code?')) {
                if (limited) return {status: 403, headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30)}, body: {message: 'API rate limit exceeded'}}
                return {total_count: 2, items: [{path: 'docs/notes.md', text_matches: []}, {path: 'lib/calc.py', text_matches: [{fragment: 'def compute(n):'}]}]}
            }
            if (path === `${R}/contents/lib/calc.py?ref=${head}`) return {raw: 'import os\n\ndef compute(n):\n    return n\n'}
        })
        await page.goto(`${url}&file=app/main.py`)
        await ready(page)
        await nameIn(page, '.sbs-right', 'print(compute', 'compute').click()
        await page.keyboard.press('Control+B')
        await expect(page.locator('#view-file')).toHaveClass(/active/)
        await expect(page.locator('#file-head')).toContainText('lib/calc.py')
        await expect(page.locator('#file-head')).toContainText('not changed in this pull request')
        await expect.poll(() => caret(page)).toBe('lib/calc.py:3:5')

        limited = true
        await page.keyboard.press('Control+Alt+ArrowLeft')
        await expect(page.locator('#view-sbs')).toHaveClass(/active/)
        await nameIn(page, '.sbs-right', 'print(compute', 'missing').click()
        await page.keyboard.press('Control+B')
        await expect(page.locator('#toasts')).toContainText(/code search allows 10 searches a minute: try again in (29|30) s/)
    })
})

test('without a token, the code search says it needs GitHub access', async ({page}) => {
    const {url} = fakePr(page.github, 914, [MAIN, UTIL])
    await page.goto(`${url}&file=app/main.py`)
    await ready(page)
    await nameIn(page, '.sbs-right', 'print(compute', 'missing').click()
    await page.keyboard.press('Control+B')
    await expect(page.locator('#toasts')).toContainText('needs GitHub access: sign in or add a token')
})

test('TypeScript: the language service goes to a declaration in an imported file, and shows its type on hover', async ({page}) => {
    const {github} = page
    const {url, head} = fakePr(github, 915, [{filename: 'src/a.ts', old: 'export const v = 1\n', new: 'import {helper} from \'./util\'\n\nexport const v = helper(2)\n'}])
    github.handle(({path}) => {
        if (path === `${R}/contents/src?ref=${head}`) return [{name: 'a.ts', type: 'file'}, {name: 'util.ts', type: 'file'}]
        if (path === `${R}/contents/src/util.ts?ref=${head}`) return {raw: '/** Doubles a number, as text. */\nexport function helper(x: number): string {\n    return String(x * 2)\n}\n'}
    })
    await page.goto(`${url}&file=src/a.ts`)
    await ready(page)
    const name = nameIn(page, '.sbs-right', 'helper(2)', 'helper')
    await name.hover()
    const hover = page.locator('.monaco-hover:visible')
    await expect(hover).toContainText('helper(x: number): string', {timeout: 20000})
    await expect(hover).toContainText('Doubles a number, as text.')
    await name.click({modifiers: ['Control']})
    await expect(page.locator('#file-head')).toContainText('src/util.ts')
    await expect.poll(() => caret(page)).toBe('src/util.ts:2:17')
})
