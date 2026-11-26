import {test, expect, ready, fakePr} from './fixture.js'

test.use({token: true})

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** The text of the head side of `path`, as the editor has it. */
const headText = (page, path) => page.evaluate((p) => window.monaco.editor.getModels().find((m) => m.uri.scheme === 'jd-b' && m.uri.path === '/' + p).getValue(), path)

/** The focused editor's selected text. */
const selected = (page) => page.evaluate(() => {
    const ed = window.monaco.editor.getEditors().find((e) => e.hasTextFocus())
    return ed.getModel().getValueInRange(ed.getSelection())
})

let number = 900
/** Opens a made-up pull request of one file `path` with `text` at its head, in edit mode, the caret on line `line`. */
async function editing(page, path, text, line = 1) {
    const {url} = fakePr(page.github, ++number, [{filename: path, old: '\n' + text, new: text}])
    await page.goto(`${url}&file=${path}`)
    await ready(page)
    await page.locator('#btn-edit').click()
    await page.locator('.sbs-right .view-line').nth(line - 1).click()
    await page.keyboard.press('Home')
}

test('the JetBrains keys edit in the editable side; the VS Code keymap gives Monaco its own keys back', async ({page}) => {
    const path = 'src/list.txt'
    await editing(page, path, 'one\ntwo\nthree\n', 2)
    await page.keyboard.press('Control+D')
    expect(await headText(page, path)).toBe('one\ntwo\ntwo\nthree\n')
    // the caret is on the copy, which goes: the caret is on "three"
    await page.keyboard.press('Control+Y')
    expect(await headText(page, path)).toBe('one\ntwo\nthree\n')
    await page.keyboard.press('Alt+Shift+ArrowUp')
    expect(await headText(page, path)).toBe('one\nthree\ntwo\n')
    await page.keyboard.press('Control+Z')
    await page.keyboard.press('Control+Shift+Z')
    expect(await headText(page, path)).toBe('one\nthree\ntwo\n')
    await page.keyboard.press('Control+W')
    expect(await selected(page)).toBe('three')
    // F7 still steps through the differences from the editor: back up from the caret to the removed first line
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+F7')
    await expect(page.locator('#st-pos')).toHaveText(/Difference 1 of/)

    await page.locator('#btn-app').click()
    await page.locator('#menu .menu-item', {hasText: 'VS Code'}).click()
    await page.locator('.sbs-right .view-line').nth(2).click()
    await page.keyboard.press('Home')
    // Ctrl+D selects the word (Add Selection to Next Find Match) instead of duplicating the line
    await page.keyboard.press('Control+D')
    expect(await headText(page, path)).toBe('one\nthree\ntwo\n')
    expect(await page.evaluate(() => localStorage.getItem('jd.keymap'))).toBe('"vscode"')
})

/** Opens a made-up pull request of two files in edit mode, the caret in the first file's editable side. */
async function twoFiles(page) {
    const {url} = fakePr(page.github, ++number, [{filename: 'a.txt', old: 'one two\n', new: 'one two three\n'}, {filename: 'b.txt', old: 'x\n', new: 'y\n'}])
    await page.goto(`${url}&file=a.txt`)
    await ready(page)
    await page.locator('#btn-edit').click()
    await page.locator('.sbs-right .view-line').first().click()
    await page.keyboard.press('Home')
}
const openFile = (page) => page.locator('#tree .tr-file.sel')

test('IntelliJ\'s Compare Next/Previous File keys step files, while editing too', async ({page}) => {
    await twoFiles(page)
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect(openFile(page)).toHaveAttribute('data-file', 'b.txt')
    await page.locator('.sbs-right .view-line').first().click()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(openFile(page)).toHaveAttribute('data-file', 'a.txt')
})

test.describe('on a Mac', () => {
    test.use({userAgent: MAC})
    test('⌃⇧→ steps files and ⌥→ moves by word', async ({page}) => {
        await twoFiles(page)
        await page.keyboard.press('Alt+ArrowRight')
        expect(await page.evaluate(() => window.monaco.editor.getEditors().find((e) => e.hasTextFocus()).getPosition().column)).toBe(4)
        await expect(openFile(page)).toHaveAttribute('data-file', 'a.txt')
        await page.keyboard.press('Control+Shift+ArrowRight')
        await expect(openFile(page)).toHaveAttribute('data-file', 'b.txt')
        await expect(page.locator('#btn-next-file')).toHaveAttribute('title', 'Next File (⌃⇧→)')
    })
    test('the macOS keys of the JetBrains keymap', async ({page}) => {
        const path = 'src/list.txt'
        await editing(page, path, 'one\ntwo\nthree\n', 2)
        await page.keyboard.press('Meta+D')
        expect(await headText(page, path)).toBe('one\ntwo\ntwo\nthree\n')
        await page.keyboard.press('Meta+Backspace')
        expect(await headText(page, path)).toBe('one\ntwo\nthree\n')
        await page.keyboard.press('Alt+Shift+ArrowUp')
        expect(await headText(page, path)).toBe('one\nthree\ntwo\n')
        await page.keyboard.press('Alt+ArrowUp')
        expect(await selected(page)).toBe('three')
    })
})

test('Comment Line and Block Comment use the language\'s comments', async ({page}) => {
    await editing(page, 'tool/run.py', 'x = 1\ny = 2\n')
    await page.keyboard.press('Control+/')
    expect(await headText(page, 'tool/run.py')).toBe('# x = 1\ny = 2\n')

    await editing(page, 'web/site.css', 'a { color: red; }\n')
    await page.keyboard.press('Control+/')
    expect(await headText(page, 'web/site.css')).toBe('/* a { color: red; } */\n')
    await page.keyboard.press('Control+/')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Control+Shift+/')
    expect(await headText(page, 'web/site.css')).toBe('/* a { color: red; } */\n')
})
