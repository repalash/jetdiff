import {test, expect, ready, fakePr, fakeSha} from './fixture.js'

// the labels of a file's diff: what its change is made of, and its state here
const tags = (page) => page.locator('.sbs-head-right .tag')

test('a file whose changes are whitespace only says so', async ({page}) => {
    const pr = fakePr(page.github, 9101, [
        {filename: 'a.ts', old: 'if (a) {\nb()\n}\n', new: 'if (a) {\n\tb()  \n}\n'},
        {filename: 'b.ts', old: 'if (a) {\nb()\n}\n', new: 'if (a) {\n  c()\n}\n'},
    ])
    await page.goto(pr.url)
    await ready(page)
    await expect(tags(page)).toHaveText(['whitespace only'])
    await page.locator('#btn-next-file').click()
    await ready(page)
    await expect(tags(page)).toHaveCount(0)
})

test('a change of line endings or of the byte-order mark only is named', async ({page}) => {
    const pr = fakePr(page.github, 9102, [
        {filename: 'a.txt', old: 'one\r\ntwo\r\n', new: 'one\ntwo\n'},
        {filename: 'b.txt', old: '\uFEFFone\n', new: 'one\n'},
    ])
    await page.goto(pr.url)
    await ready(page)
    await expect(page.locator('#diff-count')).toHaveText('No differences')
    await expect(tags(page)).toHaveText(['line endings changed: CRLF → LF'])
    await page.locator('#btn-next-file').click()
    await ready(page)
    await expect(tags(page)).toHaveText(['byte-order mark removed'])
})

test('a Markdown change the preview cannot show says so, and switches to Code', async ({page}) => {
    const pr = fakePr(page.github, 9103, [{filename: 'a.md',
        old: 'See [the guide](old.md).\n\nSome text.\n\n[ref]: https://a.example/\n',
        new: 'See [the guide](new.md).\n\nSome more text.\n\n[ref]: https://b.example/\n'}])
    await page.goto(pr.url)
    await ready(page)
    const hint = page.locator('.mdp-head .md-hidden')
    await expect(hint).toHaveText('2 of 3 changes not shown: see Code')
    await hint.click()
    await expect(page.locator('.mdp')).toBeHidden()
    await expect(page.locator('.sbs-right .view-lines')).toBeVisible()
})

test.describe('with a token', () => {
    test.use({token: true})

    test('a file edited here says so in its header and in the tree', async ({page}) => {
        const pr = fakePr(page.github, 9104, [{filename: 'a.txt', old: 'one\ntwo\n', new: 'one\nthree\n'}])
        await page.goto(pr.url)
        await ready(page)
        await expect(tags(page)).toHaveCount(0)
        await page.locator('#btn-edit').click()
        await page.locator('.sbs-right .view-line').nth(0).click()
        await page.keyboard.press('End')
        await page.keyboard.type(' edited')
        await expect(tags(page)).toHaveText(['edited here'])
        await expect(page.locator('#tree .tr-file.edited .ted')).toBeVisible()
        for (let i = 0; i < ' edited'.length; i++) await page.keyboard.press('Backspace')
        await expect(tags(page)).toHaveCount(0)
    })
})

test('a file marked Viewed here that changes after is not viewed any more', async ({page}) => {
    const files = [{filename: 'a.txt', old: 'a\n', new: 'b\n', sha: fakeSha(1)}, {filename: 'b.txt', old: 'a\n', new: 'b\n', sha: fakeSha(2)}]
    const pr = fakePr(page.github, 9105, files)
    await page.goto(pr.url)
    await ready(page)
    for (const i of [0, 1]) await page.locator('#tree .tr-file .tvd').nth(i).click()
    await expect(page.locator('#viewed-count')).toHaveText('2 / 2 viewed')
    // a new push changes a.txt
    files[0].sha = fakeSha(3)
    await page.reload()
    await ready(page)
    await expect(page.locator('#viewed-count')).toHaveText('1 / 2 viewed')
    await expect(page.locator('#tree .tr-file.viewed')).toHaveAttribute('data-file', 'b.txt')
})
