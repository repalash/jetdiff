// Records the GitHub API responses the page asks for into snap/<name>/, for `?snap=<name>` (GITHUB_TOKEN if set):
//   node tools/record-snapshot.cjs http://localhost:3000/ owner/repo/123 [name]
//   node tools/record-snapshot.cjs http://localhost:3000/ --repos owner/a,owner/b [name]
// --repos records what Download for offline fetches for each repository.
// A snapshot of a private repository holds its code: do not commit or publish it.

const {chromium} = require('playwright')
const {execFile} = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}

;(async () => {
    const [, , pageUrl, pr] = process.argv
    const name = (pr === '--repos' ? process.argv[5] : process.argv[4]) || 'demo'
    if (!pageUrl || !pr) throw new Error('usage: record-snapshot.cjs <page url> <owner/repo/number | --repos o/a,o/b> [name]')
    const out = path.join(__dirname, '..', 'snap', name)
    fs.mkdirSync(out, {recursive: true})
    const index = {}
    const browser = await chromium.launch()
    const ctx = await browser.newContext({serviceWorkers: 'block'})
    await ctx.route('https://api.github.com/**', async (route) => {
        const req = route.request()
        if (req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS})
        if (req.method() !== 'GET') return route.fulfill({status: 403, headers: CORS, body: '{}'})
        const u = new URL(req.url())
        const key = u.pathname + u.search
        const seen = index[key]
        if (seen && seen.status === 200) return route.fulfill({status: 200, body: fs.readFileSync(path.join(out, seen.file)), headers: {...CORS, 'content-type': seen.type}})
        // raw.githubusercontent.com does not count against the API's hourly limit, which a large PR would use up
        const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)
        const ref = u.searchParams.get('ref')
        const target = m && ref && (req.headers()['accept'] || '').includes('raw') ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${encodeURIComponent(ref)}/${m[3]}` : req.url()
        const args = ['-s', '-i', '--retry', '3', '-H', 'Accept: ' + (req.headers()['accept'] || 'application/json'), target]
        if (process.env.GITHUB_TOKEN) args.push('-H', 'Authorization: Bearer ' + process.env.GITHUB_TOKEN)
        let rest = await new Promise((resolve, reject) => execFile('curl', args, {maxBuffer: 1 << 28, encoding: 'buffer'}, (e, out) => e ? reject(e) : resolve(out)))
        let head = ''
        // skip a proxy's "Connection established" block and any 1xx
        while (rest.slice(0, 5).toString() === 'HTTP/') {
            const i = rest.indexOf('\r\n\r\n')
            head = rest.slice(0, i).toString()
            rest = rest.slice(i + 4)
        }
        const status = +head.split(' ')[1]
        const type = (head.match(/^content-type: (.*)$/im) || [])[1]?.trim() || 'application/octet-stream'
        const file = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)
        fs.writeFileSync(path.join(out, file), rest)
        index[key] = {file, status, type}
        route.fulfill({status, body: rest, headers: {...CORS, 'content-type': type}})
    })
    const page = await ctx.newPage()
    await page.goto(pageUrl)
    if (pr === '--repos') {
        const repos = process.argv[4].split(',')
        const summary = []
        for (const full of repos) {
            const [owner, repo] = full.split('/')
            const r = await page.evaluate(async ([owner, repo]) => {
                const off = await import('./js/offline.js')
                const t0 = Date.now()
                const res = await off.downloadRepo(owner, repo, {commits: true})
                const saved = off.offlineRepos().find((x) => x.owner === owner && x.repo === repo)
                return {owner, repo, prs: saved?.prs || [], failed: res.failed, s: Math.round((Date.now() - t0) / 1000)}
            }, [owner, repo])
            console.log(`${full}: ${r.prs.length} PRs, ${r.failed} failed, ${r.s}s`)
            summary.push({owner: r.owner, repo: r.repo, prs: r.prs})
        }
        fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index))
        fs.writeFileSync(path.join(out, 'repos.json'), JSON.stringify(summary))
        console.log(`${name}: ${Object.keys(index).length} responses in ${out}`)
        await browser.close()
        return
    }
    const summary = await page.evaluate(async (pr) => {
        const gh = await import('./js/github.js')
        const [owner, repo, number] = pr.split('/')
        const target = {type: 'pr', owner, repo, number: +number}
        const contents = (cs) => Promise.all(cs.files.flatMap((f) => [
            f.status !== 'added' && cs.baseSha && gh.getFileContent(owner, repo, cs.baseSha, f.prevPath || f.path).catch(() => null),
            f.status !== 'removed' && gh.getFileContent(owner, repo, cs.headSha, f.path).catch(() => null),
        ]))
        const cs = await gh.loadChangeSet(target)
        await contents(cs)
        for (const c of cs.commits) {
            const ccs = await gh.loadChangeSet({...target, commit: c.sha}).catch(() => null)
            if (ccs) await contents(ccs)
        }
        for (const state of ['open', 'closed', 'merged', 'all']) await gh.listPullRequests(owner, repo, {state}).catch(() => null)
        await gh.getTimeline(owner, repo, +number).catch(() => null)
        return {files: cs.files.length, commits: cs.commits.length}
    }, pr)
    fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1))
    console.log(`${name}: ${Object.keys(index).length} responses (${summary.files} files, ${summary.commits} commits) in ${out}`)
    await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
