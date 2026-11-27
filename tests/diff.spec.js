import {test, expect, ready, recorded, fakePr, fakeSha, PR, HEAD} from './fixture.js'

const R = '/repos/repalash/threepipe'
const short = (sha) => sha.slice(0, 8)
const lines = (n, f = (i) => `line ${i}`) => Array.from({length: n}, (_, i) => f(i + 1)).join('\n') + '\n'
const commit = (n) => ({sha: fakeSha(n), parents: [{sha: fakeSha(n - 1)}], author: null, html_url: `https://github.com${R}/commit/${fakeSha(n)}`,
    commit: {message: `Commit ${n}`, author: {name: 'A', date: '2026-01-01T00:00:00Z'}, committer: {name: 'A', date: '2026-01-01T00:00:00Z'}}})
/** Any file's contents: `text(ref)`. */
const anyContents = (github, text) => github.handle(({path}) => {
    const m = path.match(/\/contents\/.+\?ref=(\w+)$/)
    if (m) return {raw: text(m[1])}
})

test('a compare of over 100 commits shows its head and all its commits', async ({page}) => {
    const all = Array.from({length: 150}, (_, i) => commit(i + 1))
    const base = fakeSha(0)
    page.github.handle(({path}) => {
        if (path === `${R}/compare/main...feature?per_page=100`) return {total_commits: 150, commits: all.slice(0, 100), merge_base_commit: {sha: base}, base_commit: {sha: base},
            files: [{filename: 'a.txt', status: 'modified', additions: 1, deletions: 1}], html_url: `https://github.com${R}/compare/main...feature`}
        if (path === `${R}/compare/main...feature?per_page=100&page=2`) return {total_commits: 150, commits: all.slice(100)}
    })
    anyContents(page.github, (ref) => ref === base ? 'old\n' : 'new\n')
    await page.goto('./?compare=repalash/threepipe/main...feature')
    await ready(page)
    await expect(page.locator('#side-title-text')).toHaveText(`Changes Between ${short(base)} and ${short(all[149].sha)}`)
    await page.locator('#tab-log').click()
    await expect(page.locator('#log-count')).toHaveText('150 commits')
})

test('a range of a pull request\'s commits ends at its last commit, whatever the compare lists first', async ({page}) => {
    const commits = recorded(`${R}/pulls/193/commits?per_page=100&page=1`)
    const files = recorded(`${R}/pulls/193/files?per_page=100&page=1`).filter((f) => f.filename.endsWith('CloudAuth.ts'))
    // a long range: the compare's first page holds its oldest commits
    page.github.handle(({path}) => path === `${R}/compare/${commits[0].sha}...${HEAD}?per_page=100` && {total_commits: 150, commits: [commits[1]], files})
    await page.goto(`./?pr=${PR}&commit=${commits[1].sha}..${HEAD}`)
    await ready(page)
    await expect(page.locator('.sbs-head-right .sha')).toHaveText(short(HEAD))
})

test('a commit of over 100 files lists them all', async ({page}) => {
    const sha = fakeSha(0xc0)
    const files = Array.from({length: 250}, (_, i) => ({filename: `src/f${i}.txt`, status: 'modified', additions: 1, deletions: 1}))
    page.github.handle(({path}) => {
        const m = path.match(new RegExp(`^${R}/commits/${sha}\\?per_page=100(?:&page=(\\d+))?$`))
        if (m) {
            const p = +(m[1] || 1)
            return {sha, parents: [{sha: fakeSha(0xb0)}], html_url: `https://github.com${R}/commit/${sha}`,
                commit: {message: 'Big', author: {name: 'A', date: '2026-01-01T00:00:00Z'}}, files: files.slice((p - 1) * 100, p * 100)}
        }
    })
    anyContents(page.github, (ref) => ref === sha ? 'new\n' : 'old\n')
    await page.goto(`./?commit=repalash/threepipe/${sha}`)
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(250)
})

test('switching files while a diff is computed shows the differences of the file shown', async ({page}) => {
    // a long file with many changes: its diff takes a while
    const big = {filename: 'a/big.ts', old: lines(15000), new: lines(15000, (i) => i % 7 ? `line ${i}` : `changed ${i}`)}
    const small = {filename: 'b/small.ts', old: lines(30), new: lines(30, (i) => i === 3 ? 'changed' : `line ${i}`)}
    const pr = fakePr(page.github, 9005, [big, small])
    await page.goto(pr.url)
    await ready(page)
    await page.locator('#tree .tr-file[data-file="b/small.ts"]').click()
    await ready(page)
    await page.locator('#tree .tr-file[data-file="a/big.ts"]').click()
    await page.locator('#tree .tr-file[data-file="b/small.ts"]').click()
    await ready(page)
    await expect(page.locator('#diff-count')).toHaveText('1 difference')
})

test('a diff Monaco gives no answer for says it is too large, not that there are no differences', async ({page}) => {
    await page.addInitScript(() => {
        // the waits for a diff, shortened
        const setTimeout = window.setTimeout
        window.setTimeout = (f, ms, ...a) => setTimeout(f, ms >= 25000 ? 50 : ms, ...a)
        // the hidden diff editor that computes the side-by-side diffs never answers
        let monaco
        Object.defineProperty(window, 'monaco', {configurable: true, get: () => monaco, set(m) {
            monaco = m
            const create = m.editor.createDiffEditor
            m.editor.createDiffEditor = (el, opts, ...rest) => {
                const de = create.call(m.editor, el, opts, ...rest)
                if (opts?.automaticLayout === false) de.onDidUpdateDiff = () => ({dispose() {}})
                return de
            }
        }})
    })
    await page.goto(`./?pr=${PR}&file=plugins/cloud/src/auth/CloudAuth.ts`)
    await expect(page.locator('#view-msg')).toContainText('too large to compute', {timeout: 20000})
    await expect(page.locator('#diff-count')).toHaveText('Too large to compare')
})

test('a renamed Markdown file shows its removed text in the unified view', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('jd.view', '"unified"'))
    const pr = fakePr(page.github, 9001, [{filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed',
        old: '# Title\n\nA paragraph that goes away.\n\nKept.\n', new: '# Title\n\nKept.\n'}])
    await page.goto(pr.url)
    await ready(page)
    await expect(page.locator('.mdp-new')).toBeVisible()
    await expect(page.locator('.mdp-new .md-delblock')).toContainText('A paragraph that goes away.')
})

test('when the merge base cannot be read, it is asked again, then the page says what the diff is against', async ({page}) => {
    let asked = 0
    await page.route((u) => u.pathname === `${R}/compare/${recorded(`${R}/pulls/193`).base.sha}...${HEAD}`, (route) => {
        asked++
        route.fulfill({status: 502, headers: {'access-control-allow-origin': '*', 'content-type': 'application/json'}, body: '{"message":"Bad gateway"}'})
    })
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    expect(asked).toBe(2)
    await expect(page.locator('#notes')).toContainText('not where the pull request branched off')
})

test('a list of files GitHub cut short says so', async ({page}) => {
    const pr = recorded(`${R}/pulls/193`)
    page.github.handle(({path}) => path === `${R}/pulls/193` && {...pr, changed_files: 3500})
    await page.goto(`./?pr=${PR}`)
    await ready(page)
    await expect(page.locator('#notes')).toContainText('Showing 5 of 3500 changed files')

    const files = Array.from({length: 300}, (_, i) => ({filename: `f${i}.txt`, status: 'modified', additions: 1, deletions: 1}))
    page.github.handle(({path}) => path === `${R}/compare/main...many?per_page=100` && {total_commits: 1, commits: [commit(1)], files,
        merge_base_commit: {sha: fakeSha(0)}, base_commit: {sha: fakeSha(0)}, html_url: `https://github.com${R}/compare/main...many`})
    anyContents(page.github, (ref) => ref)
    await page.goto('./?compare=repalash/threepipe/main...many')
    await ready(page)
    await expect(page.locator('#notes')).toContainText('may be incomplete')
})

test('GitHub links to a range of a pull request and to a two-dot compare open what they show', async ({page}) => {
    await page.goto('./')
    const [a, b] = [fakeSha(1), fakeSha(2)]
    const parsed = await page.evaluate(([a, b]) => import('/js/github.js').then((g) => [
        `https://github.com/o/r/pull/5/files/${a}..${b}`, `https://github.com/o/r/pull/5/changes/${a}..${b}`, `https://github.com/o/r/pull/5/files/${a}`,
        'https://github.com/o/r/compare/main..dev', 'https://github.com/o/r/compare/v1.2...v1.3',
    ].map((u) => g.targetToParams(g.parseTarget(u)).toString())), [a, b])
    expect(parsed).toEqual([
        `pr=o%2Fr%2F5&commit=${a}..${b}`, `pr=o%2Fr%2F5&commit=${a}..${b}`, `pr=o%2Fr%2F5&commit=${a}`,
        'compare=o%2Fr%2Fmain..dev', 'compare=o%2Fr%2Fv1.2...v1.3',
    ])
    expect(await page.evaluate(() => import('/js/github.js').then((g) => g.targetToParams(g.paramsToTarget(new URLSearchParams('compare=o/r/main..dev'))).toString())))
        .toBe('compare=o%2Fr%2Fmain..dev')

    const commits = recorded(`${R}/pulls/193/commits?per_page=100&page=1`)
    page.github.handle(({path}) => path === `${R}/compare/${commits[0].sha}...${HEAD}?per_page=100` && {total_commits: 2, commits: commits.slice(1),
        files: recorded(`${R}/pulls/193/files?per_page=100&page=1`).filter((f) => f.filename.endsWith('CloudAuth.ts'))})
    await page.goto(`./repalash/threepipe/pull/193/files/${commits[1].sha}..${HEAD}`)
    await ready(page)
    expect(new URL(page.url()).searchParams.get('commit')).toBe(`${commits[1].sha}..${HEAD}`)
})

test('a two-dot compare shows the difference between the two tips', async ({page}) => {
    const [mergeBase, baseTip] = [fakeSha(0x10), fakeSha(0x11)]
    page.github.handle(({path}) => {
        // since the merge base: the head changed a.txt and added b.txt; the base changed a.txt and c.txt
        if (path === `${R}/compare/main...feature?per_page=100`) return {total_commits: 1, commits: [commit(0x20)], merge_base_commit: {sha: mergeBase}, base_commit: {sha: baseTip},
            files: [{filename: 'a.txt', status: 'modified', sha: fakeSha(0xa1)}, {filename: 'b.txt', status: 'added', sha: fakeSha(0xb1)}], html_url: `https://github.com${R}/compare/main...feature`}
        if (path === `${R}/compare/feature...main?per_page=1`) return {total_commits: 1, commits: [commit(0x30)], merge_base_commit: {sha: mergeBase}, base_commit: {sha: fakeSha(0x20)},
            files: [{filename: 'a.txt', status: 'modified', sha: fakeSha(0xa2)}, {filename: 'c.txt', status: 'modified', sha: fakeSha(0xc2)}]}
    })
    anyContents(page.github, (ref) => ref)
    await page.goto('./?compare=repalash/threepipe/main..feature')
    await ready(page)
    await expect(page.locator('#tree .tr-file')).toHaveCount(3)
    await expect(page.locator('#side-title-text')).toHaveText(`Changes Between ${short(baseTip)} and ${short(fakeSha(0x20))}`)
    expect(new URL(page.url()).searchParams.get('compare')).toBe('repalash/threepipe/main..feature')
})

/** A file with differences at lines 2, 5 and 80, scrolled by hand back to its top. */
async function scrolledToTop(page, number) {
    const old = lines(120)
    const changed = lines(120, (i) => [2, 5, 80].includes(i) ? `changed ${i}` : `line ${i}`)
    const pr = fakePr(page.github, number, [{filename: 'src/a.ts', old, new: changed}])
    await page.goto(pr.url)
    await ready(page)
    await expect(page.locator('#diff-count')).toHaveText('3 differences')
    await page.locator('.sbs-right').hover()
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(200)
    await page.mouse.wheel(0, -2000)
    await page.waitForTimeout(200)
}

test('Next Difference at the top of a file goes to the first difference below the top', async ({page}) => {
    await scrolledToTop(page, 9002)
    await page.locator('#btn-next-diff').click()
    await expect(page.locator('#st-pos')).toHaveText('Difference 1 of 3')
})

test('Previous Difference at the top of a file goes to a difference shown on screen before leaving the file', async ({page}) => {
    await scrolledToTop(page, 9005)
    await page.keyboard.press('Shift+F7')
    await expect(page.locator('#st-pos')).toHaveText('Difference 2 of 3')
})

test('the Markdown preview shows character references as GitHub does', async ({page}) => {
    const pr = fakePr(page.github, 9003, [{filename: 'a.md', old: 'Tom &lt; Jerry, and &amp; more.\n', new: 'Tom &gt; Jerry, and &amp;amp; more.\n'}])
    await page.goto(pr.url)
    await ready(page)
    const text = page.locator('.mdp-new .md')
    await expect(text).toContainText('Tom > Jerry, and &amp; more.')
    await expect(text).not.toContainText('&gt;')
})

test('Open on GitHub keeps a path with # % and ? whole', async ({page}) => {
    await page.addInitScript(() => { window.open = (u) => { window.opened = u; return null } })
    const pr = fakePr(page.github, 9004, [{filename: 'src/100%/a#b?.ts', old: 'a\n', new: 'b\n'}])
    await page.goto(pr.url)
    await ready(page)
    await page.locator('#btn-open-file').click()
    await page.locator('.menu-item', {hasText: 'Open New Version'}).click()
    expect(await page.evaluate(() => window.opened)).toBe(`https://github.com/repalash/threepipe/blob/${pr.head}/src/100%25/a%23b%3F.ts`)
})

test('a Markdown change fills its lines, and an inline code span changed whole is highlighted itself', async ({page}) => {
    const pr = fakePr(page.github, 9051, [{filename: 'docs/a.md', old: 'Cancelling shows no error.\n', new: 'Cancelling shows no error: `record()` returns `false`.\n'}])
    await page.goto(pr.url)
    await ready(page)
    const code = page.locator('.mdp-new code', {hasText: 'record()'})
    await expect(code).toHaveClass(/\bmdw\b.*\bins\b|\bins\b.*\bmdw\b/)
    await expect(code.locator('ins')).toHaveCount(0)
    const fill = await page.locator('.mdp-new ins.mdw').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))
    expect(fill).toBeGreaterThan(0)
})
