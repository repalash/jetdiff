import {
    accountIdentity, answerSnapshot, authConfig, commitFiles, compareDots, getFileContent, getGitCommit, getPullHead, getTimeline, getViewer, moveBranch, getToken, signedIn, signIn, signOut, takeSignInToken, getViewedStates, GitHubError, loadChangeSet,
    otherSite, PACK_ANSWER, paramsToTarget, parseTarget, listPullRequests, searchMyPullRequests, setFileViewed, setSnapshot, setToken, snapshotInfo, snapshotName, snapshotRepos,
    snapshotToAsk, targetToParams,
} from './github.js'
import {
    applyTheme, applyThemeCss, DEFAULT_THEME, ensureLanguage, fullWidthSelection, languageForPath, languageName, loadMonaco,
    MONACO_THEME, themeById, THEMES, DIFF_COLORS,
} from './editor.js'
import {SideBySideViewer} from './sbs.js'
import {FileTree} from './tree.js'
import {fileIcon, icons, isImagePath} from './icons.js'
import {formatWhen, LogView} from './log.js'
import {onDoubleShift, Palette} from './palette.js'
import {installTooltips} from './tooltip.js'
import {appOffline, clearOffline, downloadRepo, hasSavedData, importPack, offlineRepos, removeRepo, storageUse} from './offline.js'
import {highlightBlocks, renderMarkdown, repoResolvers, richSource, sanitize} from './markdown.js'
import {baseName, esc, firstLine, githubUrl, plural, shortSha as short} from './util.js'

const $ = (s, el = document) => el.querySelector(s)
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const filesLabel = (paths) => paths.length === 1 ? paths[0] : paths.length + ' files'
const repoName = (r) => `${r.owner}/${r.repo}`
const prKey = (t, n = t.number) => `${t.owner}/${t.repo}#${n}`
const prHref = (r, n) => `?pr=${r.owner}/${r.repo}/${n}`
const prState = (pr) => pr.merged_at ? 'merged' : pr.draft ? 'draft' : pr.state
/** A PR's full changes, not one of its commits or a range of them. */
const fullPr = (cs) => !!cs?.pr && !cs.commit && !cs.range
const subject = (c) => firstLine(c.commit.message)
const commitAuthor = (c) => c.author?.login || c.commit.author?.name || ''
const commitDate = (c) => c.commit.author?.date || c.commit.committer?.date
const selectedCommit = (t) => t.commit || (t.type === 'commit' ? t.sha : null)
const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

// everything works without storage (private windows, sandboxed pages)
const store = {
    raw(key) {
        try { return localStorage.getItem('jd.' + key) } catch { return null }
    },
    /** False when the value was not kept: too large, or no storage. */
    setRaw(key, v) {
        try { localStorage.setItem('jd.' + key, v); return true } catch { return false }
    },
    get(key, def) {
        const v = store.raw(key)
        if (v === null) return def
        try { return JSON.parse(v) } catch { return def }
    },
    set(key, v) {
        return store.setRaw(key, JSON.stringify(v))
    },
}

const mobileQuery = window.matchMedia('(max-width: 760px)')
const settings = {
    view: store.get('view', null), // null: side-by-side on wide screens, unified on phones
    theme: store.get('theme', DEFAULT_THEME),
    align: store.get('align', false),
    syncScroll: store.get('syncScroll', true),
    ignore: store.get('ignore', 'none'), // 'none' | 'trim' | 'all'
    highlight: store.get('highlight', 'words'), // 'words' | 'lines' | 'none'
    collapseUnchanged: store.get('collapseUnchanged', false),
    wordWrap: store.get('wordWrap', false),
    mdPreview: store.get('mdPreview', true),
    fontSize: store.get('fontSize', null),
}
const viewMode = () => settings.view || (mobileQuery.matches ? 'unified' : 'sbs')
/** 'sbs': the IDE-style side-by-side viewer; 'monaco': Monaco's diff editor (unified, or aligned side-by-side). */
const renderer = () => viewMode() === 'sbs' && !settings.align ? 'sbs' : 'monaco'
const fontSize = () => settings.fontSize || (mobileQuery.matches ? 12 : 13)
const lineHeight = () => Math.round(fontSize() * 1.54)

function setSetting(k, v) {
    settings[k] = v
    store.set(k, v)
}

const SETTING_EFFECTS = {
    align: () => applyView(),
    syncScroll: () => state.sbs?.setOptions({syncScroll: settings.syncScroll}),
    ignore: () => reopenFile(true),
    highlight: () => applyHighlight(),
    collapseUnchanged: () => applyMonacoOptions(),
    wordWrap: () => applyMonacoOptions(),
}

/** Sets a diff setting (toggles it without `v`) and applies it to the open file. */
function changeSetting(k, v = !settings[k]) {
    setSetting(k, v)
    SETTING_EFFECTS[k]()
}

function toastEl(className) {
    const el = document.createElement('div')
    el.className = className
    $('#toasts').appendChild(el)
    return el
}

function toast(message, kind = 'info', ms = 4000, action = null) {
    const el = toastEl(`toast toast-${kind}`)
    el.textContent = message
    if (action) {
        const b = document.createElement('button')
        b.className = 'toast-action'
        b.textContent = action.label
        b.onclick = () => { el.remove(); action.run() }
        el.appendChild(b)
    }
    setTimeout(() => el.classList.add('out'), ms)
    setTimeout(() => el.remove(), ms + 400)
}

function menuItemHtml(it, i) {
    if (it === '-') return '<div class="menu-sep"></div>'
    if (it.html) return `<div class="menu-html">${it.html}</div>`
    return `<button class="menu-item${it.checked ? ' checked' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
                <span class="menu-check">${it.checked ? icons.check : ''}</span>
                <span class="menu-label">${it.label}</span>${it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : ''}</button>`
}

function openMenu(anchor, items, {align = 'left', search = null} = {}) {
    const menu = $('#menu')
    const searchHtml = search
        ? `<label class="menu-search">${icons.search}<input placeholder="${esc(search)}" spellcheck="false" autocomplete="off"></label>` : ''
    menu.innerHTML = searchHtml + items.map(menuItemHtml).join('')
    menu.hidden = false
    const r = anchor.getBoundingClientRect()
    const mw = Math.min(menu.offsetWidth, window.innerWidth - 16)
    const x = align === 'right' ? r.right - mw : r.left
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px'
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 60) + 'px'
    menu.style.maxHeight = (window.innerHeight - r.bottom - 16) + 'px'
    const input = $('.menu-search input', menu)
    if (input) {
        input.oninput = () => {
            const q = input.value.trim().toLowerCase()
            for (const b of menu.querySelectorAll('.menu-item')) b.hidden = !!q && !b.textContent.toLowerCase().includes(q)
        }
        if (!mobileQuery.matches) input.focus()
    }
    menu.onclick = (e) => {
        const b = e.target.closest('.menu-item')
        if (!b) return
        const it = items[+b.dataset.i]
        if (!it.keepOpen) closeMenu()
        it.action?.()
    }
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
    function outside(e) {
        if (menu.contains(e.target)) return
        document.removeEventListener('pointerdown', outside, true)
        closeMenu()
    }
}

function closeMenu() {
    $('#menu').hidden = true
}

function openDialog(html, {focus, cancel}) {
    const dlg = $('#dialog')
    dlg.innerHTML = html
    dlg.showModal()
    $(focus, dlg).focus()
    $(cancel, dlg).onclick = () => dlg.close()
    return dlg
}

function showError(el, message) {
    el.textContent = message
    el.hidden = false
}

function tokenDialog() {
    const has = !!getToken()
    const viaApp = signedIn()
    const dlg = openDialog(`
        <form class="dlg" method="dialog">
            <h2>GitHub access</h2>
            <p>Needed for private repositories, to commit edits and to sync the <b>Viewed</b> checkboxes with GitHub. The
            token is kept in this browser's storage only and sent only to <code>api.github.com</code>.</p>
            <div id="tok-app" class="tok-app" hidden>
                ${viaApp ? `<p>${icons.check} Signed in with GitHub. The token renews itself.</p>`
                    : '<button type="button" id="tok-signin" class="btn btn-primary">Sign in with GitHub</button>'}
                <p class="dim small">Sign-in sees the repositories where the jetdiff app is
                <a id="tok-install" target="_blank" rel="noopener">installed</a>. Or paste a token instead:</p>
            </div>
            <p class="dim">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
            with <i>Contents: read</i> and <i>Pull requests: read and write</i> (write is only for Viewed) on the repositories you review,
            or a <a href="https://github.com/settings/tokens/new?scopes=repo&description=jetdiff" target="_blank" rel="noopener">classic token</a> with <code>repo</code>.</p>
            <input type="password" id="tok" placeholder="${has ? 'A token is saved. Paste a new one to replace it' : 'github_pat_… or ghp_…'}" autocomplete="off" spellcheck="false">
            <div class="dlg-actions">
                ${has ? `<button type="button" id="tok-clear" class="btn btn-ghost">${viaApp ? 'Sign out' : 'Remove token'}</button>` : ''}
                <span class="spacer"></span>
                <button type="button" id="tok-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Save</button>
            </div>
        </form>`, {focus: '#tok', cancel: '#tok-cancel'})
    authConfig().then((cfg) => {
        if (!cfg) return
        $('#tok-app', dlg).hidden = false
        $('#tok-install', dlg).href = `https://github.com/apps/${cfg.appSlug}/installations/new`
        const go = $('#tok-signin', dlg)
        if (go) go.onclick = signIn
    })
    const clear = $('#tok-clear', dlg)
    if (clear) clear.onclick = () => { dlg.close(); signOutDialog(viaApp) }
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        const v = $('#tok', dlg).value.trim()
        if (v) { setToken(v); toast('Token saved') }
        dlg.close()
        if (v) reloadTarget()
    }
}

/** The stored edits not committed yet, of every pull request: carried, waiting for their head, and kept aside. */
function storedEditCount() {
    flushEdits()
    return Object.values(editStore()).reduce((n, e) => n + Object.keys(e?.files || {}).length + (e?.pending?.length || 0) + (e?.conflicts?.length || 0), 0)
}

// what GitHub data and its traces this device keeps (not the settings, nor the edits)
const DATA_KEYS = ['recent', 'offline', 'identity', 'snap', 'packsFrom']

/** Removes the GitHub data saved on this device: the saved responses and contents, and the jd.* data keys. */
async function removeDeviceData() {
    await clearOffline()
    try {
        for (const k of DATA_KEYS) localStorage.removeItem('jd.' + k)
        // the Viewed marks and their queue
        for (const k of Object.keys(localStorage)) if (k.startsWith('jd.viewed.')) localStorage.removeItem(k)
    } catch { /* no storage */ }
    renderRecordedBar()
}

/** Removes every edit not committed yet, of every pull request. */
function removeEdits() {
    clearTimeout(saveTimer)
    state.edits = new Map()
    state.editsBase = new Map()
    try { localStorage.removeItem('jd.edits') } catch { /* no storage */ }
    renderEdits()
}

/** Sign out, or remove a pasted token: asks first, and offers to remove what this device keeps. */
function signOutDialog(viaApp) {
    const edits = storedEditCount()
    const what = viaApp ? 'Sign out' : 'Remove token'
    const dlg = openDialog(`
        <form class="dlg" method="dialog">
            <h2>${what}</h2>
            <p class="dim">${viaApp ? 'Signs out of GitHub here, and revokes the token at GitHub.' : 'Removes the token from this browser.'}</p>
            <label class="cmt-amend"><input type="checkbox" id="so-data" checked><span>Also remove data saved on this device</span></label>
            <p class="dim small">The pull requests saved for offline use and opened before, recent pull requests, Viewed marks and
            commit options. Settings such as the theme stay.</p>
            ${edits ? `<label class="cmt-amend"><input type="checkbox" id="so-edits"><span>Also remove my unpushed edits (${plural(edits, 'file')})</span></label>` : ''}
            <div class="dlg-actions">
                <span class="spacer"></span>
                <button type="button" id="so-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary" id="so-go">${what}</button>
            </div>
        </form>`, {focus: '#so-go', cancel: '#so-cancel'})
    $('form', dlg).onsubmit = async (e) => {
        e.preventDefault()
        const data = $('#so-data', dlg).checked, dropEdits = !!$('#so-edits', dlg)?.checked
        $('#so-go', dlg).disabled = true
        await signOut()
        if (data) await removeDeviceData()
        if (dropEdits) removeEdits()
        dlg.close()
        toast(viaApp ? 'Signed out' : 'Token removed')
        if (state.target) reloadTarget()
        else showLanding()
    }
}

function recents() { return store.get('recent', []) }
function addRecent(target, title) {
    const key = targetToParams(target).toString()
    const list = recents().filter((r) => r.key !== key)
    list.unshift({key, title, label: labelForTarget(target), at: Date.now()})
    store.set('recent', list.slice(0, 15))
}
function labelForTarget(t) {
    if (t.type === 'pr') return prKey(t)
    if (t.type === 'commit') return `${repoName(t)}@${short(t.sha)}`
    return `${repoName(t)} ${t.base}${compareDots(t)}${t.head}`
}

/** `label` is HTML; `title` is text. */
const landItem = (href, label, title) => `
                <a class="land-item" href="${esc(href)}"><span class="li-label">${label}</span><span class="li-title">${esc(title || '')}</span></a>`

const TITLE = 'jetdiff · Code changes in an IDE-style side-by-side diff'
const REPO_URL = 'https://github.com/repalash/jetdiff'
// for the agent's instructions file (CLAUDE.md, AGENTS.md): links it writes open here too
const AGENT_LINE = 'When it helps the reader, link GitHub pull requests, commits and compares through jetdiff instead: the same URL ' +
    'with `github.com` replaced by `jetdiff.com` (for example https://jetdiff.com/owner/repo/pull/123), which opens it in an IDE-style diff.'
const EXAMPLES = [
    ['repalash/threepipe/203', 'TypeScript, GLSL'],
    ['microsoft/vscode/350405', 'TypeScript, a big repository'],
    ['charmbracelet/glow/922', 'Go'],
    ['tokio-rs/tokio/8826', 'Rust'],
]

function showLanding(error) {
    document.title = TITLE
    $('#app').hidden = true
    const el = $('#landing')
    el.hidden = false
    const rec = recents()
    const offline = offlineRepos()
    el.innerHTML = `
        <div class="land">
            <header class="land-top">
                <a class="land-brand" href="./"><img src="./icons/icon.svg" alt="" width="36" height="36"><h1>jetdiff</h1></a>
                <a class="btn btn-ghost" href="${REPO_URL}" target="_blank" rel="noopener">${icons.github} GitHub</a>
            </header>
            <div class="land-hero">
                <div class="land-main">
                    <p class="land-pitch">Code changes in an IDE-style side-by-side diff.</p>
                    <p class="dim">Open a pull request, a commit or a compare from GitHub: a tree of the changed files, whole files
                    with highlighting, the commits, the conversation and quick edits. On any device, online or offline.</p>
                    <form id="open-form" class="land-form">
                        <input id="open-input" placeholder="https://github.com/owner/repo/pull/123" autocomplete="off" spellcheck="false" autofocus>
                        <button class="btn btn-primary" type="submit">Open</button>
                    </form>
                    <p class="dim small">Also takes <code>owner/repo#123</code>, commit URLs and compare URLs (<code>…/compare/main...feature</code>).</p>
                    ${error ? `<div class="land-error">${esc(error)}</div>` : ''}
                    <div class="land-examples"><span class="dim small">Try an example</span>${EXAMPLES.map(([pr, lang]) => {
                        const [owner, repo, number] = pr.split('/')
                        return `<a class="land-chip" href="${esc(prHref({owner, repo}, number))}">${esc(prKey({owner, repo}, number))}<span>${lang}</span></a>`
                    }).join('')}</div>
                    <div class="land-row">
                        <button class="btn btn-ghost" id="land-pack" title="An offline pack: a .zip of recorded pull requests (you can also drop it on this page)">${icons.download} Import offline pack (.zip)</button>
                        <button class="btn btn-ghost" id="land-signin" hidden>${icons.github} Sign in with GitHub</button>
                        <button class="btn btn-ghost" id="land-token">${icons.lock} ${signedIn() ? 'Signed in with GitHub'
                            : getToken() ? 'GitHub token saved: change' : 'Add a GitHub token (private repositories)'}</button>
                    </div>
                    <div class="land-agent">
                        <div class="land-agent-head"><span class="dim small">For your AI agent: add this line to <code>CLAUDE.md</code> or <code>AGENTS.md</code></span>
                            <button class="btn btn-ghost btn-small" id="land-agent-copy">${icons.copy} Copy</button></div>
                        <p class="land-agent-line" id="land-agent-line">${esc(AGENT_LINE)}</p>
                    </div>
                </div>
                <picture class="land-shot">
                    <source media="(max-width: 600px)" srcset="./docs/phone.webp" width="1170" height="1992">
                    <img src="./docs/hero.webp" alt="A pull request in jetdiff: the changed files and a side-by-side diff" width="1920" height="1146">
                </picture>
            </div>
            <div class="land-lists">
                ${offline.length ? `<h3>${icons.download} Available offline</h3><div class="land-list">${offline.map((r) => r.prs.map((p) =>
                    landItem(prHref(r, p.number), esc(prKey(r, p.number)), p.title)).join('')).join('')}</div>` : ''}
                <div id="land-snap"></div>
                <div id="land-mine"></div>
                ${rec.length ? `<h3>Recent</h3><div class="land-list">${rec.map((r) => landItem('?' + r.key, esc(r.label), r.title)).join('')}</div>` : ''}
            </div>
            <footer class="land-foot dim small">Open source (MIT) on <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>.
            Your token stays in this browser and goes only to GitHub.</footer>
        </div>`
    $('#open-form').onsubmit = (e) => {
        e.preventDefault()
        const t = parseTarget($('#open-input').value)
        if (!t) return toast('Paste a GitHub pull request, commit or compare URL', 'error')
        navigate(t)
    }
    $('#land-token').onclick = tokenDialog
    if (!getToken()) authConfig().then((cfg) => {
        const go = $('#land-signin')
        if (!cfg || !go) return
        go.hidden = false
        go.onclick = signIn
    })
    $('#land-pack').onclick = () => pickPack()
    $('#land-agent-copy').onclick = async () => {
        try {
            await navigator.clipboard.writeText(AGENT_LINE)
            toast('Copied: paste it into CLAUDE.md or AGENTS.md')
        } catch {
            // no clipboard access (an insecure origin, a refused permission): select it to copy by hand
            getSelection().selectAllChildren($('#land-agent-line'))
            toast('Select and copy the highlighted line', 'error')
        }
    }
    snapshotRepos().then((repos) => {
        if (!repos?.length || !$('#land-snap')) return
        const n = repos.reduce((a, r) => a + r.prs.length, 0)
        const saved = new Set(offlineRepos().map(repoName))
        const all = repos.every((r) => saved.has(repoName(r)))
        const status = all ? `${icons.check} On this device: they open with no network.`
            : 'Download them once on this device (online), then they open with no network.'
        $('#land-snap').innerHTML = `
            <div class="land-snap">
                <div><b>${n} pull requests</b> from ${repos.map((r) => esc(repoName(r))).join(' and ')}, recorded for reading offline.</div>
                <div class="dim small">${status}</div>
                <button class="btn ${all ? '' : 'btn-primary'}" id="land-snap-go">${icons.download} ${all ? 'Update the download' : 'Download everything for offline'}</button>
            </div>
            ${repos.map((r) => `<h3>${esc(repoName(r))} <span class="dim">(${r.prs.length})</span></h3><div class="land-list">${r.prs.map((p) =>
                landItem(prHref(r, p.number), `#${esc(p.number)}`, p.title)).join('')}</div>`).join('')}`
        if ($('#land-snap-go')) $('#land-snap-go').onclick = () => offlineDialog({all: repos})
    })
    if (getToken()) {
        const mine = $('#land-mine')
        mine.innerHTML = '<h3>Your open pull requests</h3><div class="land-list dim small">Loading…</div>'
        searchMyPullRequests().then((prs) => {
            mine.innerHTML = `<h3>Your open pull requests</h3><div class="land-list">${prs.length ? prs.map((p) =>
                landItem(prHref(p, p.number), `${esc(prKey(p))}${p.draft ? ' <i>draft</i>' : ''}`, p.title)).join('')
                : '<div class="dim small">None</div>'}</div>`
        }).catch((e) => {
            mine.innerHTML = !navigator.onLine || e.status === 503 ? '' : `<div class="dim small">Could not list your pull requests: ${esc(e.message)}</div>`
        })
    }
}

const state = {
    target: null,
    cs: null, // the loaded change set
    order: [], // files in tree order
    index: -1,
    viewed: new Set(),
    viewedRemote: null, // {id} when Viewed syncs with GitHub
    monaco: null,
    sbs: null,
    unified: null,
    differ: null,
    models: [],
    loadId: 0,
    fileLoadId: 0,
    tree: null,
    edits: new Map(), // path -> edited text of the open PR's head, not committed yet (empty off the PR's full changes)
    editKey: null, // the PR the edits belong to ('owner/repo#n'), null when not on a PR's full changes
    editHead: null, // the head commit the edits were made on
    editsBase: new Map(), // the edits as this tab last read or wrote them in storage: the others are its own changes
    editsUnsaved: false, // storage refused the last write of the edits
    ready: false, // the change set and its edits are shown (Commit is off while a load attaches the edits)
    commitGen: 0, // a commit or an undo: a newer one cancels the reload an older one waits for
    headMessage: null, // {sha, text}: the head commit's message, for Amend
    cmtExcluded: new Set(), // edited files unchecked in the Commit panel
    editing: false, // edit mode: the right side (the PR head) is editable
    editableFile: false,
    pristine: null, // the open file's text at the head
}

const currentFile = () => state.order[state.index]

function go(url) {
    history.pushState(null, '', url)
    route()
}

function navigate(target, file) {
    const p = targetToParams(target)
    if (file) p.set('file', file)
    go('?' + p.toString())
}

const navigateHere = (target) => navigate(target, currentFile()?.path)

const prTarget = (number) => ({type: 'pr', owner: state.target.owner, repo: state.target.repo, number})

function reloadTarget() {
    if (state.target) route(true)
}

/** The page's URL without the parameter `name`, in place. */
function dropParam(name) {
    const p = new URLSearchParams(location.search)
    p.delete(name)
    history.replaceState(null, '', p.size ? '?' + p : location.pathname)
}

/** Asks before showing another site's recorded data; `open` runs on Open, `cancel` on Cancel or Escape. */
function askRecorded(host, open, cancel) {
    let answered = false
    const dlg = openDialog(`
        <form class="dlg" method="dialog">
            <h2>Open recorded pull requests from ${esc(host)}?</h2>
            <p class="dim">This data comes from that site, not from GitHub.</p>
            <div class="dlg-actions"><span class="spacer"></span>
                <button type="button" id="rec-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary" id="rec-open">Open</button></div>
        </form>`, {focus: '#rec-cancel', cancel: '#rec-cancel'})
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        answered = true
        dlg.close()
        open()
    }
    dlg.addEventListener('close', () => { if (!answered) { answered = true; cancel() } }, {once: true})
}

async function route(force = false) {
    const params = new URLSearchParams(location.search)
    const ask = snapshotToAsk()
    if (ask) {
        return askRecorded(new URL(ask).host, () => { answerSnapshot(true); renderRecordedBar(); route(true) },
            () => { answerSnapshot(false); dropParam('snap'); route(true) })
    }
    renderRecordedBar()
    const packs = params.get('packs')
    if (packs && !state.packsLoading) {
        const base = new URL(packs, location.href)
        // a link imported before opens with no question (and no download)
        if (!otherSite(base.href) || store.raw('packsFrom') === packsBase(packs)) return loadPacksFrom(packs)
        return askRecorded(base.host, () => loadPacksFrom(packs), () => { dropParam('packs'); route(true) })
    }
    const target = paramsToTarget(params)
    if (!target) {
        state.cs = null
        state.key = null
        state.packAnswered = false
        renderRecordedBar()
        return showLanding()
    }
    const file = params.get('file')
    const key = targetToParams(target).toString()
    if (!force && state.cs && state.key === key) {
        if (file && file !== currentFile()?.path) selectFile(file, false)
        return
    }
    state.key = key
    await openTarget(target, file)
}

async function openTarget(target, file) {
    const id = ++state.loadId
    state.target = target
    state.ready = false
    state.offlineCopy = false
    state.packAnswered = false
    renderOffline()
    renderRecordedBar()
    renderCommitPanel(false)
    $('#landing').hidden = true
    $('#app').hidden = false
    buildShell()
    setLoading(true)
    $('#title').textContent = labelForTarget(target)
    $('#tree').innerHTML = '<div class="tree-msg dim">Loading changes…</div>'
    showMessage('')
    let cs
    try {
        ;[cs] = await Promise.all([loadChangeSet(target), ensureMonaco()])
    } catch (e) {
        if (id !== state.loadId) return
        setLoading(false)
        console.error(e)
        return showLanding(e instanceof GitHubError ? `${labelForTarget(target)}: ${e.message}` : String(e.message || e))
    }
    if (id !== state.loadId) return
    // the change set is shown with its edits only: until then, a commit would put edits made on the previous head
    // onto this one
    const edits = await attachEdits(target, cs, id)
    if (!edits) return
    state.cs = cs
    state.editKey = fullPr(cs) ? prKey(target) : null
    state.editHead = fullPr(cs) ? cs.headSha : null
    state.edits = edits
    state.editsBase = new Map(edits)
    state.ready = true
    if (fullPr(cs) && $('#cmt-amend')?.checked) loadHeadMessage().then(() => renderCommitPanel(false))
    const pk = prKey(target)
    if (state.lastPr !== pk) {
        state.lastPr = pk
        state.cmtExcluded = new Set()
        state.closedTabs = new Set()
    }
    renderEdits()
    changeSetNotices(cs)
    addRecent(target, cs.title)
    document.title = `${cs.title} · ${labelForTarget(target)}`
    renderHeader()
    state.tree.setFiles(cs.files)
    state.order = state.tree.order
    loadViewed()
    if (!cs.files.length) {
        setLoading(false)
        updateToolbar()
        return showMessage('No changed files')
    }
    const start = file ? state.order.findIndex((f) => f.path === file) : 0
    await openFileAt(start >= 0 ? start : 0, false)
}

/** What the change set leaves out, said once per load. */
function changeSetNotices(cs) {
    if (cs.noMergeBase) toast(`GitHub did not give the merge base: the diff is against the tip of ${cs.pr.base.ref}, not where the pull request branched off, so it can show changes made on ${cs.pr.base.ref} since`, 'error', 12000)
    const n = cs.incomplete
    if (n) toast(n.total ? `Showing ${n.shown} of ${n.total} changed files: GitHub lists at most ${n.limit}`
        : `The list of files may be incomplete: GitHub lists at most ${n.limit}`, 'error', 12000)
}

async function ensureMonaco() {
    if (!state.monaco) {
        const monaco = await loadMonaco()
        await applyTheme(monaco, themeById(settings.theme))
        state.monaco = monaco
    }
    return state.monaco
}

let shellBuilt = false
function buildShell() {
    if (shellBuilt) return
    shellBuilt = true
    const app = $('#app')
    app.innerHTML = `
        <header class="titlebar">
            <button class="tb-btn only-mobile" id="btn-drawer" title="Changed files">${icons.menu}</button>
            <a class="proj" id="proj" href="./" title="Open another pull request"><span class="proj-badge" id="proj-badge"></span><span class="proj-name" id="proj-name"></span></a>
            <span class="branch hide-mobile" id="branch"></span>
            <span class="tb-title" id="title"></span>
            <span class="state-pill" id="state-pill"></span>
            <span class="spacer"></span>
            <button class="offline-pill" id="offline-pill" title="Showing saved copies: no network" hidden>${icons.download}<span>Offline</span></button>
            <button class="tb-btn" id="btn-search" title="Search Everywhere (Double Shift)">${icons.search}</button>
            <a class="tb-btn" id="btn-github" target="_blank" rel="noopener" title="Open the pull request on GitHub">${icons.github}</a>
            <button class="tb-btn" id="btn-app" title="Settings: theme, editor font, GitHub token">${icons.gear}</button>
        </header>
        <div class="main">
            <nav class="strip hide-mobile">
                <button class="strip-btn" id="strip-commit" title="Commit (edits made here)">${icons.commit}<i class="strip-badge" id="strip-badge" hidden></i></button>
                <button class="strip-btn active" id="strip-changes" title="Changes">${icons.changes}</button>
                <button class="strip-btn" id="strip-prs" title="Pull requests of the repository">${icons.pr}</button>
            </nav>
            <aside class="side" id="side">
                <div class="side-head">
                    <button class="side-title" id="side-title" title="Choose a commit"><span id="side-title-text">Changes</span>${icons.chevronDown}</button>
                    <button class="tb-btn only-mobile" id="btn-drawer-close" title="Close">${icons.close}</button>
                </div>
                <div class="pr-head" id="pr-head" hidden>
                    <div class="pr-title" id="pr-title"></div>
                    <div class="pr-links"><button class="pr-link" id="pr-timeline">View Timeline</button><a class="pr-link" id="pr-link" target="_blank" rel="noopener">Open PR on GitHub</a></div>
                    <div class="pr-from"><span>Changes from</span>
                        <button class="pr-commits" id="pr-commits"></button><button class="pr-clear" id="pr-clear" title="Show all commits" hidden>${icons.close}</button>
                        <span class="pr-branch" id="pr-branch"></span>
                    </div>
                </div>
                <div class="side-tools">
                    <button class="tb-btn" id="btn-expand" title="Expand All">${icons.expand}</button>
                    <button class="tb-btn" id="btn-collapse" title="Collapse All">${icons.collapse}</button>
                    <button class="tb-btn" id="btn-reload" title="Reload">${icons.refresh}</button>
                    <span class="spacer"></span>
                    <span class="viewed-count" id="viewed-count" title="Files marked as viewed"></span>
                </div>
                <div class="tree" id="tree"></div>
                <div class="prl" id="prl" hidden>
                    <div class="prl-tools">
                        <label class="log-search">${icons.search}<input id="prl-search" placeholder="Search pull requests" spellcheck="false" autocomplete="off"></label>
                    </div>
                    <div class="prl-filters"><button class="prl-state" id="prl-state"></button><span class="spacer"></span><button class="tb-btn" id="prl-reload" title="Reload">${icons.refresh}</button></div>
                    <div class="prl-list" id="prl-list"></div>
                </div>
                <div class="cmt" id="cmt" hidden>
                    <div class="side-tools">
                        <button class="tb-btn" id="cmt-rollback" title="Rollback: discard the edits of the checked files">${icons.undo}</button>
                        <button class="tb-btn" id="cmt-expand" title="Expand All">${icons.expand}</button>
                        <button class="tb-btn" id="cmt-collapse" title="Collapse All">${icons.collapse}</button>
                    </div>
                    <div class="tree" id="cmt-tree"></div>
                    <div class="cmt-bottom">
                        <button class="cmt-aside" id="cmt-aside" title="Edits of files that changed on GitHub since: not applied" hidden></button>
                        <div class="cmt-opts">
                            <label class="cmt-amend" title="Replace the last commit of the branch (a force push)"><input type="checkbox" id="cmt-amend"><span>Amend last commit</span></label>
                            <span class="spacer"></span><span class="cmt-count" id="cmt-count"></span>
                        </div>
                        <textarea id="cmt-msg" placeholder="Commit Message" spellcheck="true"></textarea>
                        <button class="cmt-who" id="cmt-who" title="Commit Options: author and committer"></button>
                        <div class="cmt-err" id="cmt-err" hidden></div>
                        <div class="cmt-actions">
                            <button class="btn btn-primary" id="cmt-go">Commit and Push</button>
                            <span class="cmt-to dim" id="cmt-to"></span>
                            <button class="tb-btn cmt-gear" id="cmt-options" title="Commit Options: author and committer">${icons.gear}</button>
                        </div>
                    </div>
                </div>
            </aside>
            <div class="splitter hide-mobile" id="splitter"></div>
            <div class="scrim only-mobile" id="scrim"></div>
            <section class="content">
                <div class="tabs">
                    <button class="tab" id="tab-log" title="Commits">${icons.log}<span>Log</span><i class="tab-x" data-close="log" title="Close">${icons.close}</i></button>
                    <button class="tab active" id="tab-changes">${icons.changes}<span id="tab-label">Changes</span></button>
                    <button class="tab" id="tab-timeline" hidden>${icons.comment}<span>Timeline</span><i class="tab-x" data-close="timeline" title="Close">${icons.close}</i></button>
                </div>
                <div class="log-host" id="log-host" hidden></div>
                <div class="timeline-host" id="timeline-host" hidden></div>
                <div class="toolbar" id="toolbar">
                    <button class="tb-btn" id="btn-prev-diff" title="Previous Difference (Shift+F7)">${icons.up}</button>
                    <button class="tb-btn" id="btn-next-diff" title="Next Difference (F7)">${icons.down}</button>
                    <button class="tb-btn hide-mobile" id="btn-open-file" title="Open the file on GitHub: the new or the old version, or its diff">${icons.external}</button>
                    <button class="tb-btn" id="btn-prev-file" title="Previous File (Alt+←)">${icons.left}</button>
                    <span class="file-pos" id="file-pos"></span>
                    <button class="tb-btn" id="btn-next-file" title="Next File (Alt+→)">${icons.right}</button>
                    <span class="spacer"></span>
                    <button class="btn btn-primary btn-commit" id="btn-commit" title="Commit the edits to the pull request's branch" hidden>${icons.commit}<span></span></button>
                    <button class="tb-btn" id="btn-edit" title="Edit the pull request's files (then commit to its branch)" hidden>${icons.pencil}</button>
                    <label class="viewed-toggle" title="Mark the file as viewed (V)"><input type="checkbox" id="chk-viewed"><span>Viewed</span></label>
                    <span class="diff-count" id="diff-count"></span>
                    <div class="seg seg-md" id="seg-md" hidden>
                        <button class="tb-btn tb-text" id="btn-md-preview" title="Show the Markdown rendered">${icons.eye}<span>Preview</span></button>
                        <button class="tb-btn tb-text" id="btn-md-code" title="Show the Markdown code">${icons.code}<span>Code</span></button>
                    </div>
                    <div class="seg">
                        <button class="tb-btn" id="btn-sbs" title="Side-by-side viewer">${icons.sideBySide}</button>
                        <button class="tb-btn" id="btn-unified" title="Unified viewer">${icons.unified}</button>
                    </div>
                    <button class="tb-btn" id="btn-settings" title="Diff settings">${icons.gear}</button>
                </div>
                <div class="viewer" id="viewer" data-hl="${settings.highlight}">
                    <div class="view" id="view-sbs"></div>
                    <div class="view" id="view-unified">
                        <div class="uni-head" id="uni-head"><span id="uni-left"></span><span id="uni-right"></span></div>
                        <div class="uni-ed" id="uni-ed"></div>
                    </div>
                    <div class="view view-md" id="view-md"></div>
                    <div class="view view-msg" id="view-msg"></div>
                    <div class="loading-bar" id="loading-bar"></div>
                </div>
            </section>
        </div>
        <footer class="statusbar hide-mobile">
            <span class="st-group" data-tab="changes"><span id="st-lang" class="st-item"></span><span class="spacer"></span><span id="st-stat"></span><span id="st-pos"></span></span>
            <span class="st-group" data-tab="log" hidden><span class="st-item" id="st-log-n"></span><span class="spacer"></span><span class="st-item" id="st-log-sel"></span></span>
            <span class="st-group" data-tab="timeline" hidden><span class="st-item" id="st-tl"></span><span class="spacer"></span><span class="st-item" id="st-tl-n"></span></span>
        </footer>`

    state.tree = new FileTree($('#tree'), {
        // on a phone the drawer covers the diff, so a click brings the diff to the front
        onSelect: (path) => { selectFile(path); if (mobileQuery.matches) { setTab('changes'); closeDrawer() } },
        onOpen: () => setTab('changes'),
        onToggleViewed: (path) => { const f = state.order.find((x) => x.path === path); if (f) toggleViewed(f, !state.viewed.has(path)) },
    })
    $('#pr-commits').onclick = (e) => commitMenu(e.currentTarget)
    $('#pr-clear').onclick = () => navigateHere({...state.target, commit: undefined})
    $('#strip-prs').onclick = () => setSidePanel(state.sidePanel === 'prs' ? 'changes' : 'prs')
    $('#strip-commit').onclick = () => setSidePanel(state.sidePanel === 'commit' ? 'changes' : 'commit')
    state.cmtTree = new FileTree($('#cmt-tree'), {
        checks: true,
        rootLabel: 'Changes',
        onSelect: (path) => { selectFile(path); setTab('changes'); if (mobileQuery.matches) closeDrawer() },
        onToggleViewed: (path) => { state.cmtExcluded.has(path) ? state.cmtExcluded.delete(path) : state.cmtExcluded.add(path); renderCommitPanel() },
    })
    $('#cmt-expand').onclick = () => state.cmtTree.collapseAll(false)
    $('#cmt-collapse').onclick = () => state.cmtTree.collapseAll(true)
    $('#cmt-rollback').onclick = () => rollbackChecked()
    $('#cmt-amend').onchange = () => onAmendToggle()
    $('#cmt-msg').oninput = () => renderCommitPanel(false)
    $('#cmt-msg').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCommit() } }
    $('#cmt-go').onclick = () => doCommit()
    $('#cmt-options').onclick = () => commitOptionsDialog()
    $('#cmt-aside').onclick = () => state.target?.type === 'pr' && conflictsDialog(prKey(state.target))
    $('#cmt-who').onclick = () => commitOptionsDialog()
    $('#prl-state').onclick = (e) => openMenu(e.currentTarget, ['open', 'closed', 'merged', 'all'].map((v) => ({
        label: cap(v), checked: state.prlState === v, action: () => { state.prlState = v; loadPrList() },
    })))
    $('#prl-reload').onclick = () => loadPrList()
    let prlTimer
    $('#prl-search').oninput = () => { clearTimeout(prlTimer); prlTimer = setTimeout(loadPrList, 450) }
    $('#prl-list').onclick = (e) => {
        const a = e.target.closest('.prl-item')
        if (!a) return
        e.preventDefault()
        setSidePanel('changes')
        closeDrawer()
        navigate(prTarget(+a.dataset.n))
    }
    $('#btn-prev-diff').onclick = () => stepDiff(-1)
    $('#btn-next-diff').onclick = () => stepDiff(1)
    $('#btn-prev-file').onclick = () => stepFile(-1)
    $('#btn-next-file').onclick = () => stepFile(1)
    $('#btn-sbs').onclick = () => setView('sbs')
    $('#btn-unified').onclick = () => setView('unified')
    $('#btn-settings').onclick = (e) => settingsMenu(e.currentTarget)
    $('#btn-open-file').onclick = (e) => openMenu(e.currentTarget, openOnGitHubItems())
    $('#btn-app').onclick = (e) => appMenu(e.currentTarget)
    $('#offline-pill').onclick = () => offlineDialog()
    renderOffline()
    $('#btn-expand').onclick = () => state.tree.collapseAll(false)
    $('#btn-collapse').onclick = () => state.tree.collapseAll(true)
    $('#btn-reload').onclick = () => reloadTarget()
    $('#btn-edit').onclick = () => setEditing(!state.editing)
    $('#btn-commit').onclick = () => openCommitPanel()
    $('#tab-log').onclick = (e) => e.target.closest('.tab-x') ? closeTab('log') : setTab('log')
    $('#tab-changes').onclick = () => setTab('changes')
    $('#tab-timeline').onclick = (e) => e.target.closest('.tab-x') ? closeTab('timeline') : setTab('timeline')
    $('#pr-timeline').onclick = () => openTimeline()
    $('#timeline-host').onclick = (e) => {
        const li = e.target.closest('.tl-commits li[data-sha]')
        if (li) return openCommitSpec(li.dataset.sha)
        const p = e.target.closest('.tl-path')
        if (p) { setTab('changes'); selectFile(p.dataset.path) }
    }
    $('#btn-md-preview').onclick = () => {
        if (state.mdFailed) { state.mdFailed = false; if (settings.mdPreview) return reopenFile(true) }
        if (!settings.mdPreview) toggleMdPreview()
    }
    $('#btn-md-code').onclick = () => settings.mdPreview && toggleMdPreview()
    $('#side-title').onclick = (e) => state.sidePanel !== 'prs' && commitMenu(e.currentTarget)
    $('#chk-viewed').onchange = (e) => toggleViewed(currentFile(), e.target.checked)
    $('#btn-drawer').onclick = openDrawer
    $('#btn-drawer-close').onclick = closeDrawer
    $('#scrim').onclick = closeDrawer
    $('#strip-changes').onclick = () => {
        if (state.sidePanel && state.sidePanel !== 'changes') return setSidePanel('changes')
        document.body.classList.toggle('side-hidden')
    }
    $('#proj').onclick = (e) => { e.preventDefault(); projectMenu(e.currentTarget) }
    setupSplitter()
    setupPalette()
    window.addEventListener('keydown', onKey, true)
    mobileQuery.addEventListener('change', () => {
        if (!settings.view) applyView()
        applyFont()
    })
}

function setupSplitter() {
    const side = $('#side')
    side.style.width = store.get('sideWidth', 300) + 'px'
    const sp = $('#splitter')
    sp.addEventListener('pointerdown', (e) => {
        sp.setPointerCapture(e.pointerId)
        const startX = e.clientX, startW = side.offsetWidth
        const move = (ev) => { side.style.width = Math.max(180, Math.min(700, startW + ev.clientX - startX)) + 'px' }
        const up = () => {
            sp.removeEventListener('pointermove', move)
            sp.removeEventListener('pointerup', up)
            store.set('sideWidth', side.offsetWidth)
        }
        sp.addEventListener('pointermove', move)
        sp.addEventListener('pointerup', up)
    })
}

function setSidePanel(which) {
    state.sidePanel = which
    const prs = which === 'prs', cmt = which === 'commit', other = prs || cmt
    document.body.classList.remove('side-hidden')
    $('#strip-changes').classList.toggle('active', !other)
    $('#strip-prs').classList.toggle('active', prs)
    $('#strip-commit').classList.toggle('active', cmt)
    $('#prl').hidden = !prs
    $('#cmt').hidden = !cmt
    for (const id of ['#tree', '#side > .side-tools']) $(id).hidden = other
    renderSideHead()
    if (prs) loadPrList()
    if (cmt) renderCommitPanel()
}

function renderSideHead() {
    const prs = state.sidePanel === 'prs', cmt = state.sidePanel === 'commit', other = prs || cmt
    $('#pr-head').hidden = other || !state.cs?.pr
    $('.side-head').classList.toggle('prs', other)
    $('#side-title-text').textContent = prs ? `Pull Requests · ${state.target.repo}` : cmt ? 'Commit' : state.sideTitle || 'Changes'
    $('#side-title').classList.toggle('no-menu', other || !state.cs?.commits?.length)
}

async function loadPrList() {
    const t = state.target
    state.prlState ??= 'open'
    $('#prl-state').innerHTML = `${cap(state.prlState)} ${icons.chevronDown}`
    const id = (state.prlLoad = (state.prlLoad || 0) + 1)
    const list = $('#prl-list')
    list.innerHTML = '<div class="tree-msg dim">Loading…</div>'
    try {
        const prs = await listPullRequests(t.owner, t.repo, {state: state.prlState, text: $('#prl-search').value})
        if (id !== state.prlLoad) return
        list.innerHTML = prs.map((p) => `
            <a class="prl-item${t.type === 'pr' && t.number === p.number ? ' sel' : ''}" data-n="${esc(p.number)}" href="${esc(prHref(t, p.number))}">
                <div class="prl-row"><span class="prl-title">${esc(p.title)}</span>${p.draft ? '<span class="prl-draft">DRAFT</span>' : ''}
                    <span class="prl-com" title="Comments">${icons.comment}${esc(p.comments)}</span></div>
                <div class="prl-meta">#${esc(p.number)} · created ${esc(dayOf(p.created))}, by ${esc(p.user || '')}${p.state !== 'open' ? ` · ${esc(p.state)}` : ''}</div>
            </a>`).join('') || '<div class="tree-msg dim">No pull requests</div>'
    } catch (e) {
        if (id === state.prlLoad) list.innerHTML = `<div class="tree-msg dim">${esc(e.message)}</div>`
    }
}

function dayOf(iso) {
    const d = new Date(iso), now = new Date()
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const days = Math.round((day(now) - day(d)) / 86400000)
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, {year: '2-digit', month: '2-digit', day: '2-digit'})
}

function openDrawer() { document.body.classList.add('drawer-open') }
function closeDrawer() { document.body.classList.remove('drawer-open') }

function renderHeader() {
    const {cs, target} = state
    const pr = cs.pr
    const words = target.repo.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ')
    $('#proj-badge').textContent = words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'R'
    $('#proj-name').textContent = target.repo
    $('#proj').title = `${repoName(target)}: recent and other pull requests`
    $('#branch').innerHTML = pr ? `${icons.branch}<span>${esc(pr.head.ref)}</span>` : ''
    $('#branch').title = pr ? `${pr.head.label} → ${pr.base.label}` : ''
    $('#title').innerHTML = pr ? `<span class="dim">#${esc(pr.number)}</span> ${esc(cs.title)}` : esc(cs.title)
    $('#title').title = cs.title
    const pill = $('#state-pill')
    if (pr) {
        const s = prState(pr)
        pill.textContent = cap(s)
        pill.className = `state-pill st-${s}`
    } else pill.className = 'state-pill hidden'
    $('#btn-github').href = githubUrl(cs.htmlUrl) + (fullPr(cs) ? '/files' : '')
    const range = cs.range && `${short(cs.range[0])}..${short(cs.range[1])}`
    $('#tab-log').hidden = !cs.commits?.length || !!state.closedTabs?.has('log')
    if (cs.commits?.length) {
        state.log ??= new LogView($('#log-host'), {onOpen: openCommitSpec, onSelect: (html) => { $('#st-log-sel').innerHTML = html }})
        $('#st-log-n').innerHTML = `${icons.log}${plural(cs.commits.length, 'commit')}${pr ? ` on ${esc(pr.head.ref)}` : ''}`
        state.log.setCommits(cs.commits, {owner: target.owner, repo: target.repo, selected: selectedCommit(target), headRef: pr?.head.ref})
    }
    state.sideTitle = range ? `Commits ${range}`
        : cs.commit ? `Commit ${short(cs.headSha)}` : `Changes Between ${short(cs.baseSha) || '∅'} and ${short(cs.headSha)}`
    $('#side').classList.toggle('is-pr', !!pr)
    renderSideHead()
    const tlKey = pr ? prKey(target, pr.number) : null
    if (state.timelineKey && state.timelineKey !== tlKey) {
        state.timelineKey = null
        $('#tab-timeline').hidden = true
        $('#timeline-host').innerHTML = ''
        if (state.tab === 'timeline') setTab('changes')
    }
    if (pr) {
        $('#pr-title').innerHTML = `${esc(pr.title)} <span class="dim">#${esc(pr.number)}</span>`
        $('#pr-link').href = githubUrl(pr.html_url)
        $('#pr-commits').innerHTML = (range || (cs.commit ? `commit ${short(cs.headSha)}` : plural(cs.commits?.length || 0, 'commit'))) + icons.chevronDown
        $('#pr-clear').hidden = !(cs.commit || cs.range)
        $('#pr-branch').innerHTML = `${icons.tag}<span>${esc(pr.head.ref)}</span>`
        $('#pr-branch').title = `${pr.head.label} → ${pr.base.label}`
    }
}

const OPEN_ANOTHER_ITEM = {label: `${icons.folder} Open Another Pull Request…`, action: openPrDialog}

function showPrList() {
    setSidePanel('prs')
    openDrawer()
}

function projectMenu(anchor) {
    const cur = state.target ? targetToParams(state.target).toString() : ''
    const rec = recents().filter((r) => r.key !== cur).slice(0, 8)
    openMenu(anchor, [
        {label: `${icons.pr} Pull Requests of ${esc(state.target.repo)}`, action: showPrList},
        OPEN_ANOTHER_ITEM,
        ...(rec.length ? ['-', {html: 'Recent'}] : []),
        ...rec.map((r) => ({label: `${esc(r.title || r.label)}<div class="menu-sub">${esc(r.label)}</div>`, action: () => go('?' + r.key)})),
        '-',
        {label: 'Start Page', action: () => go('./')},
    ])
}

function openPrDialog() {
    const dlg = openDialog(`
        <form class="dlg" method="dialog">
            <h2>Open a pull request</h2>
            <p class="dim">A GitHub pull request, commit or compare URL, or <code>owner/repo#123</code>.</p>
            <input id="op-url" placeholder="https://github.com/owner/repo/pull/123" autocomplete="off" spellcheck="false">
            <div class="dlg-err" id="op-err" hidden></div>
            <div class="dlg-actions"><span class="spacer"></span>
                <button type="button" id="op-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Open</button></div>
        </form>`, {focus: '#op-url', cancel: '#op-cancel'})
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        const t = parseTarget($('#op-url', dlg).value)
        if (!t) return showError($('#op-err', dlg), 'Not a pull request, commit or compare link')
        dlg.close()
        navigate(t)
    }
}

function commitMenu(anchor) {
    const {cs, target} = state
    if (!cs?.commits?.length) return
    const sel = selectedCommit(target)
    const items = target.type !== 'pr' ? [] : [
        {label: `All commits (${cs.commits.length})`, checked: !target.commit, action: () => navigateHere({...target, commit: undefined})},
        {label: `${icons.log} Show Log`, action: showLog},
        '-',
    ]
    for (const c of cs.commits) {
        items.push({
            label: `${esc(subject(c))}<div class="menu-sub">${esc(commitAuthor(c))}, ${esc(formatWhen(commitDate(c)))} · <code>${short(c.sha)}</code></div>`,
            checked: !!sel && c.sha.startsWith(sel),
            action: () => navigateHere(target.type === 'pr' ? {...target, commit: c.sha} : {type: 'commit', owner: target.owner, repo: target.repo, sha: c.sha}),
        })
    }
    openMenu(anchor, items, {search: 'Search commits'})
}

function settingsMenu(anchor) {
    const option = (k, labels) => (v) => ({label: labels[v], checked: settings[k] === v, action: () => changeSetting(k, v)})
    const ignore = option('ignore', {none: 'None', trim: 'Trim whitespaces', all: 'Ignore whitespaces'})
    const hl = option('highlight', {lines: 'Lines', words: 'Words', none: 'None'})
    const toggle = (k, label, disabled = false) => ({label, checked: settings[k], disabled, action: () => changeSetting(k)})
    openMenu(anchor, [
        {label: 'Side-by-Side Viewer', checked: viewMode() === 'sbs', action: () => setView('sbs')},
        {label: 'Unified Viewer', checked: viewMode() === 'unified', action: () => setView('unified')},
        '-',
        toggle('align', 'Align Changes In Side-by-Side Diff'),
        toggle('syncScroll', 'Synchronize Scrolling', renderer() !== 'sbs'),
        '-',
        {html: 'Ignore Differences'},
        ignore('none'), ignore('trim'), ignore('all'),
        '-',
        {html: 'Highlighting Differences'},
        hl('lines'), hl('words'), hl('none'),
        '-',
        toggle('collapseUnchanged', 'Collapse Unchanged Fragments', renderer() !== 'monaco'),
        toggle('wordWrap', 'Soft-Wrap', renderer() !== 'monaco'),
        {label: 'Markdown Files as Preview', checked: settings.mdPreview, action: toggleMdPreview},
        '-',
        ...openOnGitHubItems(),
    ], {align: 'right'})
}

function appMenu(anchor) {
    openMenu(anchor, [
        {html: 'Appearance'},
        {label: `Theme: ${esc(themeById(settings.theme).name)} ▸`, keepOpen: true, action: () => themeMenu(anchor)},
        '-',
        {html: `Editor font <span class="dim">(${fontSize()}px, code only)</span>`},
        {label: 'Increase Font Size', hint: `${MOD}=`, keepOpen: true, action: () => { changeFont(1); appMenu(anchor) }},
        {label: 'Decrease Font Size', hint: `${MOD}−`, keepOpen: true, action: () => { changeFont(-1); appMenu(anchor) }},
        {label: 'Reset Font Size', hint: `${MOD}0`, action: () => changeFont(0)},
        '-',
        {html: 'GitHub'},
        {label: `${icons.lock} ${signedIn() ? 'Signed in with GitHub…' : getToken() ? 'Token saved: change or remove…' : 'Sign In or Add a Token…'}`, action: tokenDialog},
        OPEN_ANOTHER_ITEM,
        {label: `${icons.download} Offline: Download and Saved Data…`, action: offlineDialog},
        '-',
        {label: `Double Shift: Search Everywhere · F7 / ⇧F7: differences · Alt+→ / Alt+←: files · V: viewed`, disabled: true},
    ], {align: 'right'})
}

function openOnGitHubItems() {
    const f = currentFile(), cs = state.cs, t = state.target
    if (!f || !cs) return []
    const blob = (sha, path) => () => window.open(`https://github.com/${t.owner}/${t.repo}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`, '_blank', 'noopener')
    const items = []
    if (f.status !== 'removed') {
        items.push({label: `${icons.external} Open New Version on GitHub <span class="dim">${short(cs.headSha)}</span>`, action: blob(cs.headSha, f.path)})
    }
    if (f.status !== 'added' && cs.baseSha) {
        items.push({label: `${icons.external} Open Old Version on GitHub <span class="dim">${short(cs.baseSha)}</span>`, action: blob(cs.baseSha, f.prevPath || f.path)})
    }
    items.push({label: `${icons.external} Show This File's Diff on GitHub`, action: async () => {
        // opened before the await: popup blockers allow a window only during the click
        const w = window.open('about:blank', '_blank')
        // GitHub's anchor for a file in a diff is the SHA-256 of its path
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.path))
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
        if (w) w.location = `${githubUrl(cs.htmlUrl)}${fullPr(cs) ? '/files' : ''}#diff-${hash}`
    }})
    return items
}

/** Changes the editor's text size only; 0 resets it. */
function changeFont(delta) {
    setSetting('fontSize', delta === 0 ? null : Math.max(8, Math.min(24, fontSize() + delta)))
    applyFont()
    toast(`Editor font ${fontSize()}px`, 'info', 1200)
}

function themeMenu(anchor) {
    const item = (t) => ({label: esc(t.name), checked: t.id === settings.theme, action: () => setThemeId(t.id)})
    openMenu(anchor, [
        {html: 'Dark'}, ...THEMES.filter((t) => t.dark).map(item),
        '-',
        {html: 'Light'}, ...THEMES.filter((t) => !t.dark).map(item),
    ], {align: 'right'})
}

async function setThemeId(id) {
    const theme = themeById(id)
    setSetting('theme', theme.id)
    applyThemeCss(theme)
    if (state.monaco) {
        await applyTheme(state.monaco, theme)
        state.sbs?.draw()
        // the open file's models were tokenized with the old theme
        reopenFile(true)
    }
    toast(theme.name, 'info', 1200)
}

function applyHighlight() {
    $('#viewer').dataset.hl = settings.highlight
    state.sbs?.setOptions({highlight: settings.highlight})
}

function closeTab(tab) {
    state.closedTabs ??= new Set()
    state.closedTabs.add(tab)
    $('#tab-' + tab).hidden = true
    if (state.tab === tab) setTab('changes')
}

function showLog() {
    state.closedTabs?.delete('log')
    $('#tab-log').hidden = false
    setTab('log')
    closeDrawer()
}

function setTab(tab) {
    state.tab = tab
    for (const k of ['log', 'changes', 'timeline']) $('#tab-' + k).classList.toggle('active', k === tab)
    $('#log-host').hidden = tab !== 'log'
    $('#timeline-host').hidden = tab !== 'timeline'
    $('#toolbar').hidden = tab !== 'changes'
    $('#viewer').hidden = tab !== 'changes'
    for (const g of document.querySelectorAll('.statusbar .st-group')) g.hidden = g.dataset.tab !== tab
}

/** Opens a commit, or an 'a..b' range, of the loaded changes, optionally at a file. */
function openCommitSpec(spec, file) {
    const t = state.target
    const [base, head] = spec.split('..')
    const next = t.type === 'pr' ? {...t, commit: spec}
        : spec.includes('..') ? {type: 'compare', owner: t.owner, repo: t.repo, base: base + '^', head}
            : {type: 'commit', owner: t.owner, repo: t.repo, sha: spec}
    setTab('changes')
    navigate(next, file)
}

const viewedKey = () => `viewed.${repoName(state.target)}/${state.target.type === 'pr' ? '#' + state.target.number : state.cs.headSha}`
/** Viewed marks made offline, sent to GitHub on the next load. */
const pendingKey = () => viewedKey() + '.pending'

async function loadViewed() {
    state.viewedRemote = null
    state.viewed = new Set(store.get(viewedKey(), []))
    renderViewed()
    const t = state.target
    if (t.type !== 'pr' || !getToken()) return
    const id = state.loadId
    try {
        const {id: prId, states} = await getViewedStates(t.owner, t.repo, t.number)
        if (id !== state.loadId) return
        state.viewedRemote = {id: prId}
        state.viewed = new Set([...states].filter(([, s]) => s === 'VIEWED').map(([p]) => p))
        const key = pendingKey()
        // a mark leaves the queue once GitHub has it; one that fails is sent again on the next load
        for (const [path, v] of Object.entries(store.get(key, {}))) {
            if (!states.has(path) || (states.get(path) === 'VIEWED') === v) { dropPending(key, path, v); continue }
            v ? state.viewed.add(path) : state.viewed.delete(path)
            setFileViewed(prId, path, v).then(() => dropPending(key, path, v), () => {})
        }
        renderViewed()
    } catch (e) {
        console.warn('Viewed state from GitHub unavailable; keeping it in this browser', e)
    }
}

/** Removes a queued Viewed mark, unless it was toggled again since. */
function dropPending(key, path, v) {
    const p = store.get(key, {})
    if (p[path] !== v) return
    delete p[path]
    store.set(key, p)
}

function renderViewed() {
    state.tree.setViewed(state.viewed)
    const total = state.cs?.files.length || 0
    const n = state.cs ? state.cs.files.filter((f) => state.viewed.has(f.path)).length : 0
    $('#viewed-count').innerHTML = total ? `${icons.eye}<span>${n} / ${total} viewed</span>` : ''
    $('#viewed-count').title = state.viewedRemote ? 'Viewed files (synced with GitHub)' : 'Viewed files (kept in this browser; add a token to sync with GitHub)'
    const f = currentFile()
    $('#chk-viewed').checked = !!f && state.viewed.has(f.path)
}

async function toggleViewed(file, viewed) {
    if (!file) return
    viewed ? state.viewed.add(file.path) : state.viewed.delete(file.path)
    renderViewed()
    const pend = () => store.set(pendingKey(), {...store.get(pendingKey(), {}), [file.path]: viewed})
    if (state.viewedRemote) {
        try {
            await setFileViewed(state.viewedRemote.id, file.path, viewed)
            // a mark still queued for this file would undo this one on the next load
            dropPending(pendingKey(), file.path, !viewed)
        } catch (e) {
            if (e instanceof TypeError || e?.status === 503 || !navigator.onLine) {
                pend()
                store.set(viewedKey(), [...state.viewed])
                return
            }
            toast(`GitHub did not save Viewed: ${e.message}`, 'error')
            viewed ? state.viewed.delete(file.path) : state.viewed.add(file.path)
            renderViewed()
        }
    } else {
        store.set(viewedKey(), [...state.viewed])
        if (getToken() && state.target?.type === 'pr') pend()
    }
}

function selectFile(path, push = true) {
    const i = state.order.findIndex((f) => f.path === path)
    if (i >= 0) openFileAt(i, push)
}

function stepFile(dir) {
    const i = state.index + dir
    if (i >= 0 && i < state.order.length) openFileAt(i)
}

function reopenFile(keepScroll = true) {
    if (state.index >= 0) openFileAt(state.index, false, keepScroll)
}

async function contentOf(ref, path) {
    if (!ref) return {text: ''}
    return getFileContent(state.target.owner, state.target.repo, ref, path)
}

/** The line changes of a file; an added or removed file is one change. Null once `stale()` (a newer load started). */
async function fileChanges(f, original, modified, stale) {
    if (f.status === 'added') {
        return [{originalStartLineNumber: 0, originalEndLineNumber: 0, modifiedStartLineNumber: 1, modifiedEndLineNumber: modified.getLineCount()}]
    }
    if (f.status === 'removed') {
        return [{originalStartLineNumber: 1, originalEndLineNumber: original.getLineCount(), modifiedStartLineNumber: 0, modifiedEndLineNumber: 0}]
    }
    return computeDiff(original, modified, stale)
}

async function openFileAt(i, push = true, keepScroll = false) {
    if (!state.cs) return
    const f = state.order[i]
    if (!f) return
    const id = ++state.fileLoadId
    state.index = i
    state.tree.select(f.path)
    if (state.cmtTree?.root) state.cmtTree.select(f.path)
    if (push) {
        const p = targetToParams(state.target)
        p.set('file', f.path)
        history.replaceState(null, '', '?' + p.toString())
    }
    $('#tab-label').textContent = state.target.type === 'pr' ? `Diff for Pull Request #${state.target.number}` : `Changes: ${baseName(f.path)}`
    $('#tab-label').title = f.path
    $('#file-pos').textContent = `${i + 1}/${state.order.length} files`
    $('#st-lang').innerHTML = `${fileIcon(f.path)}<span>${esc(languageName(languageForPath(f.path)))}</span>`
    $('#st-stat').innerHTML = `<span class="add">+${esc(f.additions ?? '?')}</span> <span class="del">−${esc(f.deletions ?? '?')}</span>`

    renderViewed()
    state.editableFile = false
    state.tooLarge = false
    applyEditable()
    updateToolbar()
    setLoading(true)

    const {cs} = state
    const origPath = f.prevPath || f.path
    let orig, mod
    try {
        ;[orig, mod] = await Promise.all([
            f.status === 'added' ? {text: ''} : contentOf(cs.baseSha, origPath),
            f.status === 'removed' ? {text: ''} : contentOf(cs.headSha, f.path),
        ])
    } catch (e) {
        if (id !== state.fileLoadId) return
        setLoading(false)
        return showMessage(`Could not load ${esc(f.path)}<div class="dim small">${esc(e.message)}</div>`)
    }
    if (id !== state.fileLoadId) return

    const added = f.status === 'added'
    const labels = {
        left: `${icons.lock}<span class="sha">${added ? '∅' : short(cs.baseSha) || '∅'}</span><span class="path">${esc(origPath)}</span>`,
        right: (added ? icons.lock : '')
            + `<span class="sha">${f.status === 'removed' ? 'Deleted' : short(cs.headSha)}</span>`
            + (fullPr(cs) ? '<span class="dim">Head of the pull request</span>' : '')
            + (f.prevPath ? `<span class="path">${esc(f.path)}</span>` : '')
            + (added ? '<span class="tag tag-add">new file</span>' : '')
            + (mod.readOnly && canEdit(f) ? `<span class="tag tag-ro" title="An edit would change the rest of the file too">read-only: ${esc(mod.readOnly)}</span>` : ''),
    }

    if (orig.binary || mod.binary) {
        setLoading(false)
        return showBinary(f, orig, mod)
    }

    const monaco = state.monaco
    const lang = await ensureLanguage(monaco, languageForPath(f.path))
    if (id !== state.fileLoadId) return
    const old = state.models
    // a fresh URI per load: the previous models are disposed only after the new ones are shown
    const uri = (side) => monaco.Uri.parse(`jd-${side}://${id}/${f.path.split('/').map(encodeURIComponent).join('/')}`)
    // a file whose text cannot be written back as it was read stays as it is (mod.readOnly says why)
    state.editableFile = canEdit(f) && !mod.readOnly
    const edited = state.editableFile && state.edits.has(f.path)
    const original = monaco.editor.createModel(orig.text, lang, uri('a'))
    const modified = monaco.editor.createModel(mod.text, lang, uri('b'))
    // edits are compared with the model's own text: Monaco keeps a BOM aside and evens out mixed line endings
    state.pristine = modelText(modified)
    if (edited) modified.setValue(state.edits.get(f.path))
    state.models = [original, modified]
    if (state.editableFile) modified.onDidChangeContent(() => onEdited(f, original, modified, id))
    // tokenize up front: deleted lines in the unified view otherwise can render before their colors exist
    for (const m of state.models) if (m.getLineCount() < 20000) m.tokenization.forceTokenization(m.getLineCount())

    const preview = mdPreviewOn(f)
    $('#seg-md').hidden = !isMarkdown(f.path)
    $('#btn-md-preview').classList.toggle('on', preview)
    $('#btn-md-code').classList.toggle('on', !preview)
    const stale = () => id !== state.fileLoadId
    try {
        if (preview) {
            const changes = await fileChanges(f, original, modified, stale)
            if (id !== state.fileLoadId) return
            state.unified?.setModel(null)
            if (!await showMarkdownPreview(f, original.getValue(), modified.getValue(), changes, labels, id, keepScroll)) return
        } else if (renderer() === 'sbs') {
            const changes = await fileChanges(f, original, modified, stale)
            if (id !== state.fileLoadId) return
            showView('sbs')
            state.unified?.setModel(null)
            const sc = keepScroll && state.sbs ? state.sbs.right.getScrollTop() : 0
            ensureSbs().setModels(original, modified, changes, labels)
            if (changes.length && !keepScroll) state.sbs.goTo(0)
            else if (sc) state.sbs.right.setScrollTop(sc)
        } else {
            showView('unified')
            $('#uni-left').innerHTML = labels.left
            $('#uni-right').innerHTML = labels.right
            $('#uni-head').classList.toggle('aligned', viewMode() === 'sbs')
            const de = ensureUnified()
            de.updateOptions(monacoOptions())
            const updated = waitForDiff(de)
            de.setModel({original, modified})
            if (!await updated) throw new DiffTooLarge()
            if (id !== state.fileLoadId) return
            if (!keepScroll && de.getLineChanges()?.length) de.revealFirstDiff?.()
        }
    } catch (e) {
        if (!(e instanceof DiffTooLarge)) throw e
        if (id !== state.fileLoadId) return
        setLoading(false)
        state.tooLarge = true
        return showMessage(`The diff of ${esc(f.path)} is too large to compute<div class="dim small">No result in ${(DIFF_TIME + DIFF_GRACE) / 1000} s</div>`)
    } finally {
        old.forEach((m) => setTimeout(() => m.dispose(), 0))
    }
    setLoading(false)
    applyEditable()
    updateToolbar()
    prefetch(i + 1)
}

function isMarkdown(path) {
    return /\.(md|markdown|mdx)$/i.test(path)
}

function mdPreviewOn(f) {
    return isMarkdown(f.path) && settings.mdPreview && !(state.editing && state.editableFile) && !state.mdFailed
}

function toggleMdPreview() {
    setSetting('mdPreview', !settings.mdPreview)
    if (settings.mdPreview && state.editing) state.editing = false
    reopenFile(true)
}

/** Line sets of a diff: inserted / modified lines on the new side, deleted / modified on the old (1-based). */
function changedLines(lineChanges) {
    const r = {ins: new Set(), mod: new Set(), del: new Set(), modOld: new Set()}
    for (const c of lineChanges) {
        const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
        if (hasM) for (let l = c.modifiedStartLineNumber; l <= c.modifiedEndLineNumber; l++) (hasO ? r.mod : r.ins).add(l)
        if (hasO) for (let l = c.originalStartLineNumber; l <= c.originalEndLineNumber; l++) (hasM ? r.modOld : r.del).add(l)
    }
    return r
}

const sourceBlocks = (el) => [...el.querySelectorAll('[data-sl]')].map((e) => ({e, sl: +e.dataset.sl, el: +e.dataset.el}))

/** False when the preview could not show (it then falls back to the code). */
async function showMarkdownPreview(f, oldText, newText, lineChanges, labels, id, keepScroll) {
    const {cs, target: t} = state
    const L = changedLines(lineChanges)
    // `map` gives the source line of each rendered line
    const classify = (mod, other, cls, map) => (a, b) => {
        let r = ''
        for (let i = a; i < b; i++) {
            const l = map[i]
            if (!l) continue
            if (mod.has(l)) return 'md-mod'
            if (other.has(l)) r = cls
        }
        return r
    }
    const sides = f.status === 'removed' ? ['old'] : f.status !== 'added' && viewMode() === 'sbs' ? ['old', 'new'] : ['new']
    // a renamed, copied or changed file has removed text too
    const both = f.status !== 'added' && f.status !== 'removed'
    const unified = sides.length === 1 && both
    const scroll = keepScroll ? $('#view-md .mdp-pane:last-child .mdp-body')?.scrollTop : 0
    let html
    try {
        html = await Promise.all(sides.map((s) => {
            const old = s === 'old'
            const whole = old ? f.status === 'removed' : f.status === 'added'
            const src = whole ? {text: old ? oldText : newText, map: null} : richSource(oldText, newText, lineChanges, s, unified)
            return renderMarkdown(src.text, {
                marks: !whole,
                map: src.map,
                classify: whole ? null : old ? classify(L.modOld, L.del, 'md-del', src.map) : classify(L.mod, L.ins, 'md-ins', src.map),
                ...(old ? repoResolvers(t.owner, t.repo, cs.baseSha, f.prevPath || f.path) : repoResolvers(t.owner, t.repo, cs.headSha, f.path)),
            })
        }))
    } catch (e) {
        console.error(e)
        toast(`The Markdown preview could not load (${e.message}); showing the code`, 'error')
        state.mdFailed = true
        if (id === state.fileLoadId) reopenFile(true)
        return false
    }
    if (id !== state.fileLoadId) return false
    const view = $('#view-md')
    const legend = !both ? `<span class="mdp-legend">${f.status === 'added' ? 'New file' : 'Deleted file'}</span>`
        : '<span class="mdp-legend" title="Blocks: a bar and tint on the left. Words: highlighted inside the text.">'
            + '<i class="lg-ins"></i>added <i class="lg-mod"></i>changed <i class="lg-del"></i>removed'
            + (sides.length > 1 ? '' : ' (struck through)') + '</span>'
    view.innerHTML = `<div class="mdp${sides.length > 1 ? ' two' : ''}">${sides.map((s, i) => `
        ${i ? '<canvas class="mdp-div"></canvas>' : ''}<div class="mdp-pane mdp-${s}"><div class="mdp-head">${s === 'old' ? labels.left : labels.right}${i === sides.length - 1 ? legend : ''}</div>
            <div class="mdp-body"><article class="md">${html[i]}</article></div></div>`).join('')}</div>`
    showView('md')
    const main = $('.mdp-pane:last-child .mdp-body', view)
    state.mdMarks = mdStops(main, lineChanges, f)
    state.mdCur = -1
    if (scroll) main.scrollTop = scroll
    else if (state.mdMarks.length && both) markCurrent(0, false)
    const bodies = [...view.querySelectorAll('.mdp-body')]
    state.mdRefresh = null
    state.mdObserver?.disconnect()
    if (bodies.length === 2) linkMarkdownPanes(view, bodies, lineChanges)
    for (const b of bodies) b.addEventListener('scroll', () => updateToolbar(), {passive: true})
    highlightBlocks(view).then(() => state.mdRefresh?.())
    return true
}

/** Old | new Markdown: connectors between the changed blocks, and scroll sync that keeps the changes side by side. */
function linkMarkdownPanes(view, [ob, nb], lineChanges) {
    const cv = $('.mdp-div', view)
    const ctx = cv.getContext('2d')
    const OB = sourceBlocks(ob), NB = sourceBlocks(nb)
    const top = (b) => b.e.getBoundingClientRect().top
    const bottom = (b) => b.e.getBoundingClientRect().bottom
    // a change's extent on one side, in the side's content coordinates: [top, bottom], or a point after line `from`
    const extent = (B, body, from, to, point) => {
        const base = body.getBoundingClientRect().top - body.scrollTop
        if (!point) {
            const hit = B.filter((b) => b.el >= from && b.sl <= to)
            if (!hit.length) return null
            return [Math.min(...hit.map(top)) - base, Math.max(...hit.map(bottom)) - base]
        }
        const prev = B.filter((b) => b.el <= from).pop(), next = B.find((b) => b.sl > from)
        const y = prev && next ? (bottom(prev) + top(next)) / 2 - base
            : prev ? bottom(prev) - base : next ? top(next) - base : 0
        return [y - 1, y + 1]
    }
    let links = []
    const measure = () => {
        links = []
        for (const c of lineChanges) {
            const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
            const o = extent(OB, ob, c.originalStartLineNumber, c.originalEndLineNumber, !hasO)
            const n = extent(NB, nb, c.modifiedStartLineNumber, c.modifiedEndLineNumber, !hasM)
            if (o && n) links.push({o, n, type: hasO && hasM ? 'modified' : hasM ? 'inserted' : 'deleted'})
        }
    }
    const draw = () => {
        const dpr = devicePixelRatio || 1
        const w = cv.clientWidth, h = cv.clientHeight
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr)
            cv.height = Math.round(h * dpr)
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const cvTop = cv.getBoundingClientRect().top
        const oy = ob.getBoundingClientRect().top - cvTop - ob.scrollTop, ny = nb.getBoundingClientRect().top - cvTop - nb.scrollTop
        for (const l of links) {
            const a0 = l.o[0] + oy, a1 = l.o[1] + oy, b0 = l.n[0] + ny, b1 = l.n[1] + ny
            if (Math.max(a1, b1) < 0 || Math.min(a0, b0) > h) continue
            ctx.fillStyle = DIFF_COLORS[l.type]
            ctx.beginPath()
            ctx.moveTo(0, a0)
            ctx.bezierCurveTo(w / 2, a0, w / 2, b0, w, b0)
            ctx.lineTo(w, b1)
            ctx.bezierCurveTo(w / 2, b1, w / 2, a1, 0, a1)
            ctx.closePath()
            ctx.fill()
        }
    }
    // piecewise linear between the change extents, from side `from` (0: old, 1: new) to the other
    const mapY = (y, from) => {
        const p = [[0, 0], ...links.flatMap((l) => [[l.o[0], l.n[0]], [l.o[1], l.n[1]]]), [ob.scrollHeight, nb.scrollHeight]]
            .sort((a, b) => a[0] - b[0])
            .map((q) => (from === 0 ? q : [q[1], q[0]])).sort((a, b) => a[0] - b[0])
        for (let i = 1; i < p.length; i++) {
            if (y <= p[i][0]) {
                const [x0, y0] = p[i - 1], [x1, y1] = p[i]
                return x1 > x0 ? y0 + (y - x0) / (x1 - x0) * (y1 - y0) : y1
            }
        }
        return y
    }
    // the side scrolled by the user leads for a moment, so the side scrolled in reply does not scroll it back
    let lock = null, raf = 0
    const sides = [ob, nb]
    sides.forEach((b, i) => b.addEventListener('scroll', () => {
        if (settings.syncScroll && (!lock || lock === b)) {
            lock = b
            const ref = b.clientHeight / 3
            sides[1 - i].scrollTop = mapY(b.scrollTop + ref, i) - ref
            clearTimeout(lock.t)
            lock.t = setTimeout(() => { lock = null }, 80)
        }
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(draw)
    }, {passive: true}))
    const refresh = () => { if (cv.isConnected) { measure(); draw() } }
    state.mdObserver = new ResizeObserver(refresh)
    state.mdObserver.observe(cv)
    // images and highlighted code change the heights after rendering
    if (state.mdOnLoad) view.removeEventListener('load', state.mdOnLoad, true)
    state.mdOnLoad = refresh
    view.addEventListener('load', refresh, true)
    setTimeout(refresh, 400)
    refresh()
    state.mdRefresh = refresh
}

/** One stop per change, as the code view counts differences: the change's first block, or the block after a removal. */
function mdStops(main, lineChanges, f) {
    if (f.status === 'added' || f.status === 'removed') return [...main.querySelectorAll('.md > *')].slice(0, 1)
    const B = sourceBlocks(main)
    const stops = []
    for (const c of lineChanges) {
        const hasM = c.modifiedEndLineNumber > 0
        const b = hasM ? B.find((x) => x.el >= c.modifiedStartLineNumber && x.sl <= c.modifiedEndLineNumber)
            : B.find((x) => x.sl > c.modifiedStartLineNumber)
        const el = !hasM && b?.e.previousElementSibling?.classList.contains('md-delblock') ? b.e.previousElementSibling : b?.e
        if (el && !stops.includes(el)) stops.push(el)
    }
    return stops
}

function markCurrent(i, smooth = true) {
    state.mdCur = i
    const el = state.mdMarks[i]
    for (const m of state.mdMarks) m.classList.toggle('md-cur', m === el)
    // scroll the preview only (scrollIntoView would also move the page on a phone)
    const box = el?.closest('.mdp-body')
    if (box) {
        const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3
        box.scrollTo({top, behavior: smooth ? 'smooth' : 'auto'})
    }
    updateToolbar()
}

const reviewCount = (reviews) => reviews.filter((r) => r.state !== 'PENDING').length

async function openTimeline() {
    const {cs, target: t} = state
    if (!cs?.pr) return
    $('#tab-timeline').hidden = false
    setTab('timeline')
    closeDrawer()
    const pr = cs.pr
    const key = prKey(t, pr.number)
    const host = $('#timeline-host')
    if (state.timelineKey === key && host.childElementCount) return
    state.timelineKey = key
    host.innerHTML = '<div class="tl-loading dim">Loading the conversation…</div>'
    try {
        const [data, desc] = await Promise.all([getTimeline(t.owner, t.repo, pr.number), sanitize(pr.body_html || '')])
        if (state.timelineKey !== key) return
        host.innerHTML = await timelineHtml(cs, data, desc)
        host.scrollTop = 0
        $('#st-tl').innerHTML = `${icons.pr}#${pr.number} · ${prState(pr)} · ${esc(pr.user?.login || '')} → ${esc(pr.base.ref)}`
        $('#st-tl-n').textContent = `${plural(data.comments.length, 'comment')} · ${plural(reviewCount(data.reviews), 'review')} · ${data.inline.length} inline`
    } catch (e) {
        if (state.timelineKey === key) host.innerHTML = `<div class="tl-loading dim">Could not load the conversation: ${esc(e.message)}</div>`
        state.timelineKey = null
    }
}

const REVIEW_STATES = {
    APPROVED: ['approved these changes', 'ok'],
    CHANGES_REQUESTED: ['requested changes', 'bad'],
    COMMENTED: ['reviewed', ''],
    DISMISSED: ['had a review dismissed', ''],
}

async function timelineHtml(cs, {comments, reviews, inline}, desc) {
    const pr = cs.pr
    const who = (u, name) => u
        ? `<img class="tl-av" src="${esc(u.avatar_url)}${u.avatar_url?.includes('?') ? '&' : '?'}s=48" alt="" loading="lazy" crossorigin="anonymous"><b>${esc(u.login)}</b>`
        : `<span class="tl-av tl-av-none"></span><b>${esc(name || 'ghost')}</b>`
    const when = (iso) => `<span class="dim" title="${esc(new Date(iso).toLocaleString())}">${esc(formatWhen(iso))}</span>`
    const ev = []
    for (const c of cs.commits || []) ev.push({t: c.commit.committer?.date || c.commit.author?.date, kind: 'commit', c})
    for (const c of comments) ev.push({t: c.created_at, kind: 'comment', c})
    // inline comments as threads, under the review of their first comment
    const threads = new Map()
    for (const c of [...inline].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const root = c.in_reply_to_id || c.id
        if (!threads.has(root)) threads.set(root, [])
        threads.get(root).push(c)
    }
    for (const r of reviews) {
        if (r.state === 'PENDING') continue
        const roots = [...threads.values()].filter((th) => th[0].pull_request_review_id === r.id)
        // a reply in a thread comes as an empty review of its own: it shows in the thread
        if (r.state === 'COMMENTED' && !r.body && !roots.length) continue
        ev.push({t: r.submitted_at || r.created_at, kind: 'review', c: r, roots})
    }
    ev.sort((a, b) => (a.t || '').localeCompare(b.t || ''))
    const bodies = await Promise.all(ev.map((e) => e.kind === 'commit' ? null : sanitize(e.c.body_html || '')))
    const threadBodies = new Map()
    await Promise.all([...threads.values()].flat().map(async (c) => threadBodies.set(c.id, await sanitize(c.body_html || ''))))

    const hunk = (h) => {
        const lines = (h || '').split('\n').slice(1).slice(-4)
        if (!lines.length) return ''
        return `<pre class="tl-hunk">${lines.map((l) => `<span class="${l[0] === '+' ? 'hk-add' : l[0] === '-' ? 'hk-del' : ''}">${esc(l)}</span>`).join('\n')}</pre>`
    }
    const thread = (th) => {
        const line = th[0].line || th[0].original_line
        return `<div class="tl-thread"><button class="tl-path" data-path="${esc(th[0].path)}">${fileIcon(th[0].path)}<span>${esc(th[0].path)}${line ? `:${esc(line)}` : ''}</span></button>
                    ${hunk(th[0].diff_hunk)}
                    ${th.map((c) => `<div class="tl-reply"><div class="tl-meta">${who(c.user)} ${when(c.created_at)}</div><article class="md">${threadBodies.get(c.id)}</article></div>`).join('')}</div>`
    }
    let out = ''
    for (let i = 0; i < ev.length; i++) {
        const e = ev[i]
        if (e.kind === 'commit') {
            const group = [e.c]
            while (ev[i + 1]?.kind === 'commit') group.push(ev[++i].c)
            const a = group[0]
            out += `<div class="tl-item tl-commits"><div class="tl-meta"><span class="tl-ic">${icons.commit}</span>${who(a.author, a.commit.author?.name)}
                <span class="dim">added ${plural(group.length, 'commit')}</span> ${when(e.t)}</div>
                <ul>${group.map((c) => `<li data-sha="${esc(c.sha)}" title="Open this commit's changes"><span class="tl-cmsg">${esc(subject(c))}</span><code>${short(c.sha)}</code></li>`).join('')}</ul></div>`
        } else if (e.kind === 'comment') {
            out += `<div class="tl-item tl-card"><div class="tl-meta">${who(e.c.user)} <span class="dim">commented</span> ${when(e.t)}</div>
                <article class="md tl-body">${bodies[i]}</article></div>`
        } else {
            const [label, cls] = REVIEW_STATES[e.c.state] || [esc(String(e.c.state).toLowerCase()), '']
            out += `<div class="tl-item tl-card tl-review ${cls}"><div class="tl-meta">${who(e.c.user)} <span class="tl-state ${cls}">${label}</span> ${when(e.t)}</div>
                ${bodies[i] ? `<article class="md tl-body">${bodies[i]}</article>` : ''}
                ${e.roots.map(thread).join('')}</div>`
        }
    }
    const s = prState(pr)
    return `<div class="tl">
        <header class="tl-head"><h1>${esc(pr.title)} <span class="dim">#${esc(pr.number)}</span></h1>
            <div class="tl-sub"><span class="state-pill st-${esc(s)}">${esc(cap(s))}</span>
            <span><b>${esc(pr.user?.login || '')}</b> ${pr.merged_at ? 'merged' : 'wants to merge'} ${plural(cs.commits?.length || 0, 'commit')} into <code>${esc(pr.base.ref)}</code> from <code>${esc(pr.head.label)}</code></span></div></header>
        <div class="tl-item tl-card tl-desc"><div class="tl-meta">${who(pr.user)} <span class="dim">opened this pull request</span> ${when(pr.created_at)}</div>
            <article class="md tl-body">${desc || '<p class="dim">No description provided.</p>'}</article></div>
        ${out}
        <div class="tl-end dim">${plural(comments.length, 'comment')} · ${plural(reviewCount(reviews), 'review')} · <a href="${esc(githubUrl(pr.html_url))}" target="_blank" rel="noopener">Open PR on GitHub</a></div>
    </div>`
}

// a saved copy answered for the view shown (each load starts afresh)
window.addEventListener('jd-offline', () => { state.offlineCopy = true; renderOffline() })
window.addEventListener(PACK_ANSWER, () => { if (!state.packAnswered) { state.packAnswered = true; renderRecordedBar() } })

const dateOf = (d) => new Date(d).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})

/**
 * The bar over the page while recorded data shows: a snapshot (with Exit, back to live GitHub), or an imported pack
 * answering while GitHub cannot be reached.
 */
function renderRecordedBar() {
    const snap = snapshotName()
    const t = state.target
    const pack = !snap && state.packAnswered
        && (offlineRepos().find((r) => r.pack && t && r.owner === t.owner && r.repo === t.repo)?.from || 'an offline pack')
    let bar = $('#rec-bar')
    document.body.classList.toggle('has-rec-bar', !!(snap || pack))
    if (!snap && !pack) return bar?.remove()
    if (!bar) {
        bar = document.createElement('div')
        bar.id = 'rec-bar'
        bar.className = 'rec-bar'
        document.body.prepend(bar)
    }
    const from = snap ? /^https:\/\//.test(snap) ? new URL(snap).host : location.host : pack
    const key = `${snap}|${from}`
    if (bar.dataset.key === key) return
    bar.dataset.key = key
    bar.innerHTML = `${icons.download}<span class="rec-text">Recorded data from <b>${esc(from)}</b><span class="rec-date"></span></span>
        ${snap ? '<button class="rec-exit" id="rec-exit" title="Leave the recorded data: show live GitHub">Exit</button>' : ''}`
    if (snap) {
        $('#rec-exit', bar).onclick = exitSnapshot
        snapshotInfo().then((info) => {
            if (info?.date && bar.dataset.key === key) $('.rec-date', bar).textContent = ` · ${dateOf(info.date)}`
        })
    }
}

function exitSnapshot() {
    setSnapshot('')
    dropParam('snap')
    renderRecordedBar()
    route(true)
}
window.addEventListener('online', () => renderOffline())
window.addEventListener('offline', () => renderOffline())
function renderOffline() {
    const pill = $('#offline-pill')
    if (!pill) return
    pill.hidden = navigator.onLine && !state.offlineCopy
}

const mb = (b) => b == null ? '?' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(b > 1e7 ? 0 : 1)} MB`
const failedNote = (n) => n ? ` (${plural(n, 'item')} failed)` : ''
const FULL_NOTE = 'The storage of this device is full: the download stopped. Remove saved data or free space, then download again.'

async function offlineDialog({all = null} = {}) {
    const dlg = $('#dialog')
    const t = state.target
    const snap = all || await snapshotRepos()
    const render = async () => {
        const repos = offlineRepos()
        const [use, saved] = await Promise.all([storageUse(), hasSavedData()])
        const here = t && !repos.some((r) => r.owner === t.owner && r.repo === t.repo)
        dlg.innerHTML = `
            <form class="dlg dlg-wide" method="dialog">
                <h2>Offline</h2>
                <p class="dim">${appOffline() ? `${icons.check} The app works offline in this browser.` : 'The app becomes available offline after this page loads once more.'}
                Downloaded pull requests open with no network, with their files, commits and conversations. Everything you open is kept too.
                Edits and Viewed marks made offline stay on this device; Commit and Push, and Viewed sync, once you are online.</p>
                <div class="off-list">${repos.length ? repos.map((r) => `
                    <div class="off-row"><div class="off-name"><b>${esc(r.owner)}/${esc(r.repo)}</b><span class="dim">${plural(r.prs.length, 'pull request')}${r.commits ? ', with commits' : ''} · ${esc(formatWhen(new Date(r.at).toISOString()))}</span></div>
                        <button type="button" class="btn btn-small" data-update="${esc(r.owner)}/${esc(r.repo)}">Update</button>
                        <button type="button" class="btn btn-small btn-ghost" data-remove="${esc(r.owner)}/${esc(r.repo)}">Remove</button></div>`).join('')
                    : '<div class="dim small">Nothing downloaded yet.</div>'}</div>
                ${snap?.length ? `<div class="off-new">
                    <div><b>This link's recorded pull requests</b> <span class="dim">(${snap.map((r) => `${esc(r.repo)}: ${r.prs.length}`).join(', ')})</span></div>
                    <div class="dlg-row"><button type="button" class="btn btn-primary" id="off-all">${icons.download} Download everything for offline</button></div>
                </div>` : ''}
                ${t && !snap?.length ? `<div class="off-new">
                    <div><b>${esc(t.owner)}/${esc(t.repo)}</b> <span class="dim">${here ? '' : '(downloaded: Update fetches new PRs and changes)'}</span></div>
                    <label class="cmt-amend"><input type="checkbox" id="off-commits" checked><span>Each commit's changes too (more data)</span></label>
                    <div class="dlg-row"><button type="button" class="btn btn-primary" id="off-go">${icons.download} Download open pull requests</button>
                    ${t.type === 'pr' ? `<button type="button" class="btn" id="off-one">Only #${t.number}</button>` : ''}</div>
                </div>` : ''}
                <div class="dlg-row"><button type="button" class="btn" id="off-pack">${icons.download} Import offline pack (.zip)</button></div>
                <div class="off-progress" id="off-progress" hidden><div class="off-bar"><i></i></div><span class="dim small" id="off-step"></span></div>
                <p class="dim small">${use ? `Storage used: ${mb(use.usage)} of ${mb(use.quota)}.` : ''} On iPhone and iPad, add the page to the Home Screen (Share → Add to Home Screen) so the saved data stays; Safari may clear the data of sites not opened for a few weeks.</p>
                <div class="dlg-actions">
                    <button type="button" class="btn btn-ghost" id="off-clear" ${saved ? '' : 'disabled'}>Remove all saved data</button>
                    <span class="spacer"></span>
                    <button type="button" class="btn" id="off-close">Close</button>
                </div>
            </form>`
        const onClick = (sel, fn) => { const b = $(sel, dlg); if (b) b.onclick = fn }
        onClick('#off-close', () => dlg.close())
        onClick('#off-clear', async () => {
            if (!confirm('Remove all saved pull requests from this device?')) return
            await clearOffline()
            toast('Saved data removed')
            render()
        })
        dlg.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => { const [o, r] = b.dataset.remove.split('/'); await removeRepo(o, r); render() })
        dlg.querySelectorAll('[data-update]').forEach((b) => b.onclick = () => { const [o, r] = b.dataset.update.split('/'); run(o, r) })
        onClick('#off-go', () => run(t.owner, t.repo))
        onClick('#off-all', () => runAll(snap))
        onClick('#off-pack', () => { dlg.close(); pickPack() })
        onClick('#off-one', () => run(t.owner, t.repo, [t.number]))
    }
    // locks the dialog for a download; Close becomes Stop
    const begin = () => {
        if (!navigator.onLine) {
            toast('No network to download from', 'error')
            return null
        }
        for (const b of dlg.querySelectorAll('button')) if (b.id !== 'off-close') b.disabled = true
        $('#off-progress', dlg).hidden = false
        const ctl = new AbortController()
        $('#off-close', dlg).textContent = 'Stop'
        $('#off-close', dlg).onclick = () => ctl.abort()
        return ctl
    }
    const progress = (fraction, text) => {
        $('.off-bar i', dlg).style.width = `${Math.min(100, Math.round(fraction * 100))}%`
        $('#off-step', dlg).textContent = text
    }
    // every repository of the snapshot, one after the other, as one progress
    const runAll = async (list) => {
        const ctl = begin()
        if (!ctl) return
        let prs = 0, failed = 0, full = false
        try {
            for (const [i, r] of list.entries()) {
                if (ctl.signal.aborted || full) break
                const res = await downloadRepo(r.owner, r.repo, {
                    numbers: r.prs.map((p) => p.number), commits: true, signal: ctl.signal,
                    onProgress: ({done, total, step}) => progress((i + done / Math.max(1, total)) / list.length, `${r.repo} (${i + 1} of ${list.length}): ${step} · ${done} / ${total}`),
                })
                prs += res.prs
                failed += res.failed
                full ||= !!res.full
            }
            if (full) toast(`${FULL_NOTE} ${prs} pull requests were saved.`, 'error', 15000)
            else toast(ctl.signal.aborted ? 'Download stopped' : `${prs} pull requests saved for offline${failedNote(failed)}`, failed ? 'error' : 'info', 8000)
        } catch (e) {
            toast(`Download failed: ${e.message}`, 'error', 8000)
        }
        if (dlg.open) render()
        if (!$('#landing').hidden) showLanding()
    }
    const run = async (owner, repo, numbers = null) => {
        const commits = $('#off-commits', dlg)?.checked ?? true
        const ctl = begin()
        if (!ctl) return
        try {
            const r = await downloadRepo(owner, repo, {
                numbers, commits, signal: ctl.signal,
                onProgress: ({done, total, step}) => progress(done / Math.max(1, total), `${step} · ${done} / ${total}`),
            })
            if (r.full) toast(`${FULL_NOTE} ${owner}/${repo}: ${plural(r.prs, 'pull request')} saved.`, 'error', 15000)
            else toast(r.aborted ? 'Download stopped' : `${owner}/${repo}: ${plural(r.prs, 'pull request')} saved for offline${failedNote(r.failed)}`, r.failed ? 'error' : 'info', 6000)
        } catch (e) {
            toast(`Download failed: ${e.message}`, 'error', 8000)
        }
        if (dlg.open) render()
    }
    dlg.showModal()
    await render()
}

function pickPack() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'
    input.multiple = true
    input.onchange = () => loadPacks([...input.files])
    input.click()
}

const packsBase = (folder) => folder.endsWith('/') ? folder : folder + '/'

/** Downloads and imports the offline packs listed in <folder>/packs.json. */
async function loadPacksFrom(folder) {
    const base = packsBase(folder)
    // already imported on this device (the link opened again offline): no download
    if (store.raw('packsFrom') === base && offlineRepos().some((r) => r.pack)) {
        history.replaceState(null, '', location.pathname)
        return route()
    }
    state.packsLoading = true
    showLanding()
    const t = toastEl('toast')
    try {
        const list = await (await fetch(base + 'packs.json')).json()
        const blobs = []
        for (const [i, name] of list.entries()) {
            const res = await fetch(base + name)
            if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
            const total = +res.headers.get('content-length') || 0
            const reader = res.body.getReader()
            const chunks = []
            let got = 0
            for (;;) {
                const {done, value} = await reader.read()
                if (done) break
                chunks.push(value)
                got += value.length
                t.textContent = `Downloading ${i + 1} of ${list.length}: ${name} · ${(got / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ''} MB`
            }
            const blob = new Blob(chunks)
            blob.name = name
            blobs.push(blob)
        }
        t.remove()
        // a sandboxed page keeps the packs in memory only: then the link has to download them again
        if (await loadPacks(blobs, new URL(base, location.href).host)) {
            store.setRaw('packsFrom', base)
            history.replaceState(null, '', location.pathname)
        }
    } catch (e) {
        t.remove()
        toast(`Could not download the packs: ${e.message}`, 'error', 10000)
    } finally {
        state.packsLoading = false
    }
}

/** Imports offline packs (`from`: the host they came from, else each file's name); true when they are kept on this device. */
async function loadPacks(files, from = '') {
    files = files.filter((f) => /\.zip$/i.test(f.name || '') || (f.type || '').includes('zip'))
    if (!files.length) return false
    const t = toastEl('toast')
    try {
        let persisted = true
        const prsOf = new Map()
        for (const f of files) {
            const r = await importPack(f, (step, i, n) => { t.textContent = `${f.name}: ${step}${n > 1 ? ` ${i} / ${n}` : '…'}` }, {from: from || f.name || ''})
            for (const x of r.repos) prsOf.set(x.repo, x.prs.length)
            persisted &&= r.persisted
        }
        const total = [...prsOf.values()].reduce((a, n) => a + n, 0)
        t.remove()
        toast(`Imported ${total} pull requests (${[...prsOf.keys()].join(', ')})${persisted ? ', kept on this device' : ': this page cannot keep data, keep the tab open'}`, 'info', 8000)
        if (!state.cs) showLanding()
        else go(location.pathname)
        return persisted
    } catch (e) {
        t.remove()
        toast(`Could not import: ${e?.name === 'QuotaExceededError' ? 'the storage of this device is full' : e.message}`, 'error', 8000)
    }
}

// links to other views of this page (?pr=…) open in place: a pack held in memory stays, and it is faster
document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="?"]')
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
    e.preventDefault()
    closeDrawer()
    go(a.getAttribute('href'))
})

window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault() })
window.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.zip$/i.test(f.name))
    if (!files.length) return
    e.preventDefault()
    loadPacks(files)
})

/** Edits belong to one head of one PR; null when not showing a PR's full changes. */
function headKey() {
    return fullPr(state.cs) ? `${prKey(state.target)}@${state.cs.headSha}` : null
}

function canEditPr() {
    const pr = state.cs?.pr
    return !!(headKey() && pr.state === 'open' && pr.head?.repo)
}

function canEdit(f = currentFile()) {
    return !!(f && canEditPr() && f.status !== 'removed' && !isImagePath(f.path))
}

function applyEditable() {
    if (!shellBuilt) return
    const ok = state.editableFile && canEdit()
    const on = ok && state.editing
    state.sbs?.setEditable(on)
    state.unified?.updateOptions({readOnly: !on, domReadOnly: !on})
    $('#btn-edit').hidden = !ok
    $('#btn-edit').classList.toggle('on', on)
    $('#viewer').classList.toggle('editing', on)
}

function setEditing(on) {
    state.editing = on
    const f = currentFile()
    // a Markdown preview is not editable: editing shows the code
    if (f && isMarkdown(f.path) && settings.mdPreview && state.editableFile) return reopenFile(true)
    applyEditable()
    if (on && state.editableFile) {
        const ed = renderer() === 'sbs' ? state.sbs?.right : state.unified?.getModifiedEditor()
        ed?.focus()
        toast('Editing the head of the pull request. Commit when done.', 'info', 3000)
    }
}

/** A model's text with its BOM, as committed. */
function modelText(m) {
    return m.getValue(undefined, true)
}

let editTimer
function onEdited(f, original, modified, id) {
    const text = modelText(modified)
    if (text === state.pristine) state.edits.delete(f.path)
    else state.edits.set(f.path, text)
    renderEdits()
    // the side-by-side viewer's bands follow the edit (Monaco's diff editor updates on its own)
    clearTimeout(editTimer)
    editTimer = setTimeout(async () => {
        const stale = () => id !== state.fileLoadId || modified.isDisposed()
        if (stale() || renderer() !== 'sbs' || !state.sbs) return
        const changes = await fileChanges(f, original, modified, stale).catch((e) => { if (e instanceof DiffTooLarge) return null; throw e })
        if (!changes || stale()) return
        state.sbs.updateChanges(changes)
        updateToolbar()
    }, 300)
}

function renderEdits() {
    if (!shellBuilt) return
    const n = state.edits.size
    $('#btn-commit').hidden = !n
    $('#btn-commit span').textContent = `Commit${n > 1 ? ` (${n})` : ''}`
    $('#strip-badge').hidden = !n
    $('#strip-badge').textContent = n
    state.tree?.setEdited(state.edits.keys())
    if (state.sidePanel === 'commit') renderCommitPanel()
    saveEdits()
}

// stored per PR with the head they were made on, so they survive a reload or a closed browser: {head, files},
// `pending`: [{path, head, text}] edits of another head not carried over to `head` yet (a read failed, or another tab
// was on that head), tried again on each load, and `conflicts`: [{path, head, text}] edits of a file that changed on
// GitHub since, kept aside (not applied) until the user copies or discards them
const editStore = () => store.get('edits', {}) || {}

/** Stores `fn(entry)` as the PR's entry, read afresh as another tab may have written it; false when not kept. */
function writeStoredEdits(key, fn) {
    const all = editStore()
    const e = fn(all[key] || {})
    if (!e.pending?.length) delete e.pending
    if (!e.conflicts?.length) delete e.conflicts
    const has = Object.keys(e.files || {}).length || e.pending || e.conflicts
    if (has) all[key] = e
    else delete all[key]
    const ok = store.set('edits', all)
    if (!ok && has && !state.editsUnsaved)
        toast('Your edits could not be saved on this device (its storage is full or unavailable): they are only in this tab until committed', 'error', 15000)
    state.editsUnsaved = !ok && !!has
    return ok
}

let saveTimer
function saveEdits() {
    clearTimeout(saveTimer)
    if (state.editKey) saveTimer = setTimeout(flushEdits, 200)
}

/** Stores the files this tab changed since it last read or wrote them, so another tab's edits of other files stay. */
function flushEdits() {
    clearTimeout(saveTimer)
    const key = state.editKey, head = state.editHead, base = state.editsBase
    if (!key) return
    const changed = [...new Set([...state.edits.keys(), ...base.keys()])].filter((p) => state.edits.get(p) !== base.get(p))
    if (!changed.length) return
    const ok = writeStoredEdits(key, (e) => {
        if (e.head && e.head !== head && Object.keys(e.files || {}).length) {
            // another tab is on another head: these wait aside until a load carries them over
            const pending = (e.pending || []).filter((p) => !(p.head === head && changed.includes(p.path)))
            for (const p of changed) if (state.edits.has(p)) pending.push({path: p, head, text: state.edits.get(p)})
            return {...e, pending}
        }
        const files = {...(e.head === head ? e.files : {})}
        for (const p of changed) state.edits.has(p) ? files[p] = state.edits.get(p) : delete files[p]
        return {...e, head, files}
    })
    if (ok) state.editsBase = new Map(state.edits)
}

/**
 * The edits of `cs` (path -> text), or null when a newer load started; none off a PR's full changes (they stay stored).
 * An edit made on another head is carried over when its file is the same at both heads, kept aside (`conflicts`) when
 * it changed, and kept as it is when a read fails (tried again on the next load).
 */
async function attachEdits(t, cs, id) {
    flushEdits()
    if (!fullPr(cs)) return new Map()
    const key = prKey(t), head = cs.headSha
    const held = (e) => [
        ...(e.head && e.head !== head ? Object.entries(e.files || {}).map(([path, text]) => ({path, head: e.head, text})) : []),
        ...(e.pending || []),
    ]
    const same = new Map() // 'head:path' -> whether the file is the same at that head and at cs's
    await Promise.all(held(editStore()[key] || {}).map(async ({path, head: h}) => {
        if (h === head) return same.set(`${h}:${path}`, true)
        try {
            const [a, b] = await Promise.all([getFileContent(t.owner, t.repo, h, path), getFileContent(t.owner, t.repo, head, path)])
            same.set(`${h}:${path}`, !a.binary && !b.binary && a.text === b.text)
        } catch (e) {
            // missing at one of the heads: changed
            if (e.status === 404) same.set(`${h}:${path}`, false)
        }
    }))
    if (id !== state.loadId) return null
    // what was typed or written by another tab meanwhile is in storage now
    flushEdits()
    const now = editStore()[key] || {}
    if (!held(now).length) return new Map(now.head === head ? Object.entries(now.files || {}) : [])
    let files = {}
    const changed = [], replaced = []
    writeStoredEdits(key, (e) => {
        files = e.head === head ? {...e.files} : {}
        const pending = [], conflicts = [...e.conflicts || []]
        for (const h of held(e)) {
            const s = same.get(`${h.head}:${h.path}`)
            if (s === undefined) pending.push(h)
            else if (!s) {
                changed.push(h.path)
                if (!conflicts.some((c) => c.path === h.path && c.head === h.head && c.text === h.text)) conflicts.push(h)
            } else if (!(h.path in files)) files[h.path] = h.text
            else if (files[h.path] !== h.text) replaced.push(h.path)
        }
        return {...e, head, files, pending, conflicts}
    })
    if (changed.length) toast(`Your edits of ${filesLabel(changed)} are kept aside: changed on GitHub since`, 'error', 12000,
        {label: 'Show', run: () => conflictsDialog(key)})
    if (replaced.length) toast(`Dropped your edits of ${filesLabel(replaced)} made on an older head: edited again since`, 'error', 8000)
    return new Map(Object.entries(files))
}

/** The edits of the PR `key` kept aside, as their file changed on GitHub since: [{path, head, text}]. */
const conflictsOf = (key) => editStore()[key]?.conflicts || []

/** Lists the edits kept aside, each with Copy, Download and Discard. */
function conflictsDialog(key) {
    const dlg = $('#dialog')
    const render = () => {
        const list = conflictsOf(key)
        if (!list.length) {
            if (dlg.open) dlg.close()
            return renderCommitPanel(false)
        }
        dlg.innerHTML = `
            <form class="dlg dlg-wide" method="dialog">
                <h2>Edits kept aside</h2>
                <p class="dim">These files changed on GitHub after you edited them, so your edits were not put on the new
                version. Copy or download your text to make the edit again, or discard it.</p>
                <div class="off-list">${list.map((c, i) => `
                    <div class="off-row"><div class="off-name"><b>${esc(c.path)}</b><span class="dim">edited on ${esc(short(c.head))}</span></div>
                        <button type="button" class="btn btn-small" data-copy="${i}">Copy</button>
                        <button type="button" class="btn btn-small" data-download="${i}">Download</button>
                        <button type="button" class="btn btn-small btn-ghost" data-discard="${i}">Discard</button></div>`).join('')}</div>
                <div class="dlg-actions"><span class="spacer"></span><button type="button" class="btn" id="cf-close">Close</button></div>
            </form>`
        $('#cf-close', dlg).onclick = () => dlg.close()
        const each = (attr, fn) => dlg.querySelectorAll(`[data-${attr}]`).forEach((b) => b.onclick = () => fn(list[+b.dataset[attr]]))
        each('copy', async (c) => {
            try {
                await navigator.clipboard.writeText(c.text)
                toast(`Copied your edit of ${baseName(c.path)}`)
            } catch (e) {
                toast(`Could not copy: ${e.message}`, 'error')
            }
        })
        each('download', (c) => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([c.text], {type: 'text/plain'}))
            a.download = baseName(c.path)
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        })
        each('discard', (c) => {
            if (!confirm(`Discard your edit of ${c.path}?`)) return
            writeStoredEdits(key, (e) => ({...e, conflicts: (e.conflicts || []).filter((x) => !(x.path === c.path && x.head === c.head && x.text === c.text))}))
            render()
        })
    }
    render()
    if (conflictsOf(key).length && !dlg.open) dlg.showModal()
    renderCommitPanel(false)
}

// another tab of this PR wrote its edits: its changes are taken where this tab has none of its own
window.addEventListener('storage', (ev) => {
    if (ev.key !== 'jd.edits' || !state.editKey || !state.ready) return
    const e = editStore()[state.editKey] || {head: state.editHead, files: {}}
    if (e.head !== state.editHead) return
    const files = e.files || {}, base = state.editsBase
    let open = false, any = false
    for (const p of new Set([...Object.keys(files), ...base.keys()])) {
        if (files[p] === base.get(p) || state.edits.get(p) !== base.get(p)) continue
        const isOpen = p === currentFile()?.path && state.editableFile
        // the file being edited here keeps its text: it is written only if edited again
        if (isOpen && state.editing) continue
        open ||= isOpen
        any = true
        if (p in files) { state.edits.set(p, files[p]); base.set(p, files[p]) }
        else { state.edits.delete(p); base.delete(p) }
    }
    if (!any) return
    renderEdits()
    if (open) reopenFile(true)
})

const checkedEdits = () => [...state.edits.keys()].filter((p) => !state.cmtExcluded.has(p))

function rollbackChecked() {
    const paths = checkedEdits()
    if (!paths.length || !confirm(`Discard the edits of ${filesLabel(paths)}?`)) return
    for (const p of paths) state.edits.delete(p)
    renderEdits()
    if (paths.includes(currentFile()?.path)) reopenFile(true)
}

/** The message of the commit the edits are on, once read; else null. */
function headCommitMessage() {
    const h = state.headMessage
    return h && h.sha === state.editHead ? h.text : null
}

// cs.commits stops at 250 and misses a push made since the load: the message is read from the commit itself
async function loadHeadMessage() {
    const sha = state.editHead, pr = state.cs?.pr
    if (!sha || !pr?.head?.repo || headCommitMessage() !== null) return
    try {
        state.headMessage = {sha, text: (await getGitCommit(pr.head.repo.owner.login, pr.head.repo.name, sha)).message || ''}
    } catch (e) {
        // a snapshot has no such response: its list of commits is complete and current
        const last = state.cs.commits?.at(-1)
        if (last?.sha === sha) state.headMessage = {sha, text: last.commit.message}
        else if (sha === state.editHead) showError($('#cmt-err'), `Could not read the last commit: ${e.message}`)
    }
}

async function onAmendToggle() {
    const ta = $('#cmt-msg')
    // as in the IDE: Amend brings the last commit's message, unticking it restores what was typed
    if (!$('#cmt-amend').checked) {
        ta.value = state.cmtTyped ?? ''
        return renderCommitPanel(false)
    }
    state.cmtTyped = ta.value
    ta.value = ''
    renderCommitPanel(false)
    await loadHeadMessage()
    if ($('#cmt-amend').checked && !ta.value) ta.value = headCommitMessage() ?? ''
    renderCommitPanel(false)
}

function renderCommitPanel(tree = true) {
    if (!shellBuilt || !state.cmtTree) return
    const files = [...state.edits.keys()].map((path) => {
        const f = state.cs?.files.find((x) => x.path === path)
        return {path, status: 'modified', additions: f?.additions ?? 0, deletions: f?.deletions ?? 0}
    })
    const included = files.filter((f) => !state.cmtExcluded.has(f.path))
    if (tree) {
        if (files.length) {
            state.cmtTree.setFiles(files)
            state.cmtTree.setViewed(new Set(included.map((f) => f.path)))
            state.cmtTree.select(currentFile()?.path)
        } else {
            state.cmtTree.clear()
            const t = state.target
            const stored = !headKey() && t?.type === 'pr' && Object.keys(editStore()[prKey(t)]?.files || {}).length
            $('#cmt-tree').innerHTML = `<div class="tree-msg dim">${stored
                ? `Your ${plural(stored, 'edited file')} ${stored === 1 ? 'is' : 'are'} kept on the pull request's head: choose <b>All commits</b> to see and commit ${stored === 1 ? 'it' : 'them'}.`
                : canEditPr()
                    ? `No changes. Turn on editing with the pencil (${icons.pencil}) over the diff, edit the right side, and commit here to <b>${esc(state.cs.pr.head.ref)}</b>.`
                    : 'Only the full changes of an open pull request can be edited and committed.'}</div>`
        }
    }
    const amend = $('#cmt-amend').checked
    const aside = state.target?.type === 'pr' ? conflictsOf(prKey(state.target)).length : 0
    $('#cmt-aside').hidden = !aside
    $('#cmt-aside').textContent = `${plural(aside, 'edit')} kept aside`
    $('#cmt-count').textContent = files.length ? `${included.length} modified` : ''
    const pr = state.cs?.pr
    $('#cmt-to').innerHTML = pr ? `to ${icons.branch}<span>${esc(pr.head.ref)}</span>` : ''
    const id = identity()
    // an amend keeps the commit's author and date, as git does; the committer is who amends
    const committer = id.committer || id.author
    $('#cmt-who').innerHTML = amend
        ? `Author: <b>the commit's own</b> (Amend keeps it) · committer: <b>${committer ? esc(committer.name) : 'your GitHub account'}</b>`
        : id.author
            ? `Author: <b>${esc(id.author.name)}</b> &lt;${esc(id.author.email)}&gt;${id.committer ? ` · committer: <b>${esc(id.committer.name)}</b>` : ''}`
            : 'Author: <b>your GitHub account</b>'
    const msg = $('#cmt-msg').value.trim()
    // an amend with no files can still change the message
    const headMsg = headCommitMessage()
    $('#cmt-go').disabled = state.committing || !state.ready || !canEditPr() || !msg
        || (!included.length && !(amend && headMsg !== null && msg !== headMsg.trim()))
    $('#cmt-go').textContent = state.committing ? 'Pushing…' : amend ? 'Amend and Push' : 'Commit and Push'
}

/** Who commits: {author, committer}, each {name, email}, or null for the token's GitHub account. */
function identity() {
    const v = store.get('identity', null)
    const ok = (p) => p && p.name && p.email ? {name: p.name, email: p.email} : null
    return {author: ok(v?.author), committer: ok(v?.committer)}
}

function commitOptionsDialog() {
    const id = identity()
    const v = (p, k) => esc(p?.[k] || '')
    const dlg = openDialog(`
        <form class="dlg" method="dialog">
            <h2>Commit Options</h2>
            <p class="dim">Who the commits made here are by. Left empty, GitHub uses the account of your token.
            GitHub links a commit to a profile by its email. Amend keeps the amended commit's author and date; its
            committer is the one given here (else the author, else your account).</p>
            <label class="dlg-label">Author</label>
            <div class="dlg-row"><input id="co-an" placeholder="Name" value="${v(id.author, 'name')}" autocomplete="name"><input id="co-ae" placeholder="Email" value="${v(id.author, 'email')}" autocomplete="email" type="email"></div>
            <label class="cmt-amend"><input type="checkbox" id="co-same" ${id.committer ? '' : 'checked'}><span>Committer is the author</span></label>
            <div class="dlg-row" id="co-crow" ${id.committer ? '' : 'hidden'}><input id="co-cn" placeholder="Committer name" value="${v(id.committer, 'name')}"><input id="co-ce" placeholder="Committer email" value="${v(id.committer, 'email')}" type="email"></div>
            <div class="dlg-tools">
                <button type="button" id="co-me" class="btn btn-small btn-ghost" title="Fill in the name and email of your token's account">Use my account</button>
                <button type="button" id="co-clear" class="btn btn-small btn-ghost">Clear</button>
            </div>
            <div class="dlg-err" id="co-err" hidden></div>
            <div class="dlg-actions">
                <span class="spacer"></span>
                <button type="button" id="co-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Save</button>
            </div>
        </form>`, {focus: '#co-an', cancel: '#co-cancel'})
    const field = (k) => $('#co-' + k, dlg)
    field('same').onchange = (e) => { field('crow').hidden = e.target.checked }
    field('clear').onclick = () => {
        for (const k of ['an', 'ae', 'cn', 'ce']) field(k).value = ''
        field('same').checked = true
        field('crow').hidden = true
    }
    field('me').onclick = async () => {
        try {
            const me = await accountIdentity()
            field('an').value = me.name
            field('ae').value = me.email
        } catch (e) {
            showError(field('err'), getToken() ? e.message : 'Add a GitHub token first')
        }
    }
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        const get = (k) => field(k).value.trim()
        const author = get('an') || get('ae') ? {name: get('an'), email: get('ae')} : null
        const committer = !field('same').checked && (get('cn') || get('ce')) ? {name: get('cn'), email: get('ce')} : null
        if ([author, committer].some((p) => p && (!p.name || !/^[^@\s]+@[^@\s]+$/.test(p.email)))) {
            return showError(field('err'), 'A name and a valid email are both needed')
        }
        store.set('identity', {author, committer})
        dlg.close()
        renderCommitPanel(false)
    }
}

function openCommitPanel() {
    setSidePanel('commit')
    if (mobileQuery.matches) openDrawer()
    setTimeout(() => $('#cmt-msg').focus(), 50)
}

async function doCommit() {
    if ($('#cmt-go').disabled || !state.ready) return
    if (!getToken()) {
        toast('Committing needs a GitHub token with Contents: write', 'error')
        return tokenDialog()
    }
    const {pr} = state.cs
    const amend = $('#cmt-amend').checked
    const message = $('#cmt-msg').value.trim()
    const paths = checkedEdits()
    if (amend && !confirm(`Amend replaces the last commit of ${pr.head.ref} (a force push). Continue?`)) return
    const where = {owner: pr.head.repo.owner.login, repo: pr.head.repo.name, branch: pr.head.ref}
    state.committing = true
    $('#cmt-err').hidden = true
    renderCommitPanel(false)
    try {
        // an edit stored before its file was known to be read-only (another version of the app, another tab)
        const t = state.target
        for (const path of paths) {
            const c = await getFileContent(t.owner, t.repo, state.editHead, path)
            if (c.readOnly) throw new GitHubError(`${path} is read-only here (${c.readOnly}): a commit would change the rest of the file. Roll its edit back or uncheck it.`, 422)
        }
        const id = identity()
        const {sha, previous} = await commitFiles({...where, expectedHead: state.editHead, message, amend, author: id.author, committer: id.committer,
            files: paths.map((path) => ({path, text: state.edits.get(path)}))})
        // the unchecked files keep their edits: unchanged by this commit, they carry over to the new head
        const committed = Object.fromEntries(paths.map((p) => [p, state.edits.get(p)]))
        state.edits = new Map([...state.edits].filter(([p]) => !paths.includes(p)))
        flushEdits()
        const key = state.editKey
        state.cmtExcluded.clear()
        $('#cmt-msg').value = ''
        $('#cmt-amend').checked = false
        state.cmtTyped = ''
        renderEdits()
        toast(`${amend ? 'Amended' : 'Committed'} ${sha.slice(0, 7)} and pushed to ${pr.head.ref}`, 'info', 10000, {
            label: 'Undo', run: () => undoCommit(where, previous, sha, key, committed),
        })
        if (await waitForHead(sha, ++state.commitGen)) reloadTarget()
    } catch (err) {
        let m = err.message
        if (err.status === 503 || err instanceof TypeError || !navigator.onLine) m = state.editsUnsaved
            ? 'No network, and this device could not save your edits: keep this tab open, and Commit and Push once you are online again.'
            : 'No network: your edits are kept on this device. Commit and Push once you are online again.'
        else if (err.status === 403 || err.status === 404) m += `. The token needs Contents: write on ${pr.head.repo.full_name}.`
        showError($('#cmt-err'), m)
    } finally {
        state.committing = false
        renderCommitPanel(false)
    }
}

/** GitHub updates the PR's head a moment after a push. False when a newer commit or undo took over (`gen`). */
async function waitForHead(sha, gen) {
    const t = state.target
    for (let k = 0; k < 10 && gen === state.commitGen; k++) {
        if (await getPullHead(t.owner, t.repo, t.number).catch(() => null) === sha) break
        await new Promise((r) => setTimeout(r, 1500))
    }
    return gen === state.commitGen
}

/** Moves the branch back and restores the committed edits, as the IDE's Undo Commit does. */
async function undoCommit(where, previous, sha, key, committed) {
    // the commit's reload would show the head this undoes, and drop the restored edits as made on another head
    const gen = ++state.commitGen
    try {
        await moveBranch({...where, sha: previous, expected: sha})
    } catch (e) {
        toast(`Undo failed: ${e.message}`, 'error', 8000)
        if (await waitForHead(sha, gen)) reloadTarget()
        return
    }
    // a load of the commit already under way is cancelled too
    state.loadId++
    // the edits made since the commit win over the committed ones; all are now edits of `previous`
    const open = state.editKey === key
    const files = {...committed, ...(open ? Object.fromEntries(state.edits) : editStore()[key]?.files || {})}
    if (open) {
        state.edits = new Map(Object.entries(files))
        state.editsBase = new Map(state.edits)
        state.editHead = previous
        // shown at the commit undone, the page offers Commit again once it shows `previous`
        if (state.cs?.headSha !== previous) state.ready = false
        renderEdits()
    }
    writeStoredEdits(key, (e) => ({...e, head: previous, files}))
    toast(`${where.branch} is back at ${previous.slice(0, 7)}`)
    if (await waitForHead(previous, gen)) reloadTarget()
}

window.addEventListener('beforeunload', (e) => {
    if (state.edits.size) { e.preventDefault(); e.returnValue = '' }
})

function prefetch(i) {
    const f = state.order[i]
    if (!f || isImagePath(f.path)) return
    const {cs} = state
    if (f.status !== 'added' && cs.baseSha) contentOf(cs.baseSha, f.prevPath || f.path).catch(() => {})
    if (f.status !== 'removed') contentOf(cs.headSha, f.path).catch(() => {})
}

// Monaco's time for one diff: past it, it gives a coarser diff
const DIFF_TIME = 20000
// and no answer at all this much later is a diff too large to compute
const DIFF_GRACE = 10000

class DiffTooLarge extends Error {}

/** Resolves true on the diff editor's next diff, false when none came in time. */
function waitForDiff(de) {
    return new Promise((resolve) => {
        const d = de.onDidUpdateDiff(() => { d.dispose(); clearTimeout(t); resolve(true) })
        const t = setTimeout(() => { d.dispose(); resolve(false) }, DIFF_TIME + DIFF_GRACE)
    })
}

// one diff at a time: the hidden diff editor holds one pair of models
let diffQueue = Promise.resolve()

/**
 * Line changes from Monaco's diff algorithm (VS Code's), computed by a diff editor that is never shown; null once
 * `stale()`. Throws DiffTooLarge when Monaco gives no answer.
 */
function computeDiff(original, modified, stale = () => false) {
    const run = diffQueue.then(() => stale() || original.isDisposed() || modified.isDisposed() ? null : diffNow(original, modified))
    diffQueue = run.catch(() => {})
    return run
}

async function diffNow(original, modified) {
    const monaco = state.monaco
    if (!state.differ) {
        const host = document.createElement('div')
        host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:400px;visibility:hidden'
        document.body.appendChild(host)
        state.differ = monaco.editor.createDiffEditor(host, {readOnly: true, renderSideBySide: true, maxComputationTime: DIFF_TIME, automaticLayout: false})
    }
    const de = state.differ
    de.updateOptions({ignoreTrimWhitespace: settings.ignore === 'trim'})
    let a = original, b = modified
    if (settings.ignore === 'all') {
        // diff with all whitespace removed from each line (line numbers stay the same); word highlights would not map back
        const strip = (m) => monaco.editor.createModel(m.getLinesContent().map((l) => l.replace(/\s+/g, '')).join('\n'), 'plaintext')
        a = strip(original)
        b = strip(modified)
    }
    const updated = waitForDiff(de)
    de.setModel({original: a, modified: b})
    const ok = await updated
    const changes = ok ? de.getLineChanges() || [] : null
    de.setModel(null) // models are disposed when the next file opens; a diff editor must not hold them then
    if (a !== original) {
        a.dispose()
        b.dispose()
        changes?.forEach((c) => { c.charChanges = undefined })
    }
    if (!changes) throw new DiffTooLarge()
    return changes
}

function ensureSbs() {
    if (!state.sbs) {
        state.sbs = new SideBySideViewer($('#view-sbs'), state.monaco, {fontSize: fontSize(), lineHeight: lineHeight(), fontFamily: FONT})
        state.sbs.onScroll = () => updateToolbar()
        state.sbs.setOptions({syncScroll: settings.syncScroll, highlight: settings.highlight})
    }
    return state.sbs
}

function monacoOptions() {
    return {
        renderSideBySide: viewMode() === 'sbs',
        renderOverviewRuler: !mobileQuery.matches,
        ignoreTrimWhitespace: settings.ignore !== 'none',
        hideUnchangedRegions: {enabled: settings.collapseUnchanged, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20},
        wordWrap: settings.wordWrap ? 'on' : 'off',
        diffWordWrap: settings.wordWrap ? 'on' : 'off',
        fontSize: fontSize(),
        lineHeight: lineHeight(),
    }
}

function ensureUnified() {
    if (!state.unified) {
        state.unified = state.monaco.editor.createDiffEditor($('#uni-ed'), {
            useInlineViewWhenSpaceIsLimited: false,
            enableSplitViewResizing: false,
            readOnly: true,
            domReadOnly: true,
            originalEditable: false,
            automaticLayout: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            roundedSelection: false,
            folding: false,
            stickyScroll: {enabled: false},
            renderIndicators: true,
            renderMarginRevertIcon: false,
            renderGutterMenu: false,
            lineDecorationsWidth: 14,
            fontFamily: FONT,
            fontLigatures: false,
            contextmenu: false,
            hover: {enabled: false},
            occurrencesHighlight: 'off',
            selectionHighlight: false,
            matchBrackets: 'never',
            guides: {indentation: false},
            unicodeHighlight: {ambiguousCharacters: false, invisibleCharacters: false},
            renderValidationDecorations: 'off',
            scrollbar: {useShadows: false, verticalScrollbarSize: 12, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false},
            maxComputationTime: 20000,
            theme: MONACO_THEME,
            ...monacoOptions(),
        })
        state.unified.getModifiedEditor().onDidScrollChange(() => updateToolbar())
        fullWidthSelection(state.monaco, state.unified.getModifiedEditor())
        fullWidthSelection(state.monaco, state.unified.getOriginalEditor())
    }
    return state.unified
}

function applyMonacoOptions() {
    state.unified?.updateOptions(monacoOptions())
}

function applyFont() {
    state.sbs?.setFont(fontSize(), lineHeight())
    applyMonacoOptions()
}

function setView(mode) {
    setSetting('view', mode)
    applyView()
}

function renderViewButtons() {
    $('#btn-sbs').classList.toggle('on', viewMode() === 'sbs')
    $('#btn-unified').classList.toggle('on', viewMode() === 'unified')
}

function applyView() {
    renderViewButtons()
    reopenFile()
}

function showView(which) {
    for (const v of ['sbs', 'unified', 'md', 'msg']) $('#view-' + v).classList.toggle('active', v === which)
    renderViewButtons()
}

const isShown = (view) => $('#view-' + view).classList.contains('active')

function showMessage(html) {
    $('#view-msg').innerHTML = html ? `<div class="msg">${html}</div>` : ''
    if (html) showView('msg')
    updateToolbar()
}

function showBinary(f, orig, mod) {
    const {cs} = state
    const size = (c) => (c?.size != null ? `${(c.size / 1024).toFixed(1)} KB` : '')
    if (isImagePath(f.path)) {
        const img = (c, label) => c?.blob
            ? `<figure><figcaption>${label} <span class="dim">${size(c)}</span></figcaption><div class="img-box"><img src="${URL.createObjectURL(c.blob)}" alt=""></div></figure>`
            : `<figure><figcaption>${label}</figcaption><div class="img-box empty dim">none</div></figure>`
        showMessage(`<div class="img-diff">${img(orig.binary ? orig : null, short(cs.baseSha) || '∅')}${img(mod.binary ? mod : null, short(cs.headSha))}</div>`)
    } else {
        showMessage(`Binary file<div class="dim small">${size(orig) || '∅'} → ${size(mod) || '∅'}</div>`)
    }
}

function diffInfo() {
    if (isShown('md')) {
        const n = state.mdMarks?.length || 0
        return {count: n, prev: state.mdCur > 0, next: state.mdCur < n - 1}
    }
    if (!isShown('msg')) {
        if (renderer() === 'sbs' && state.sbs) return {count: state.sbs.count, prev: state.sbs.canStep(-1), next: state.sbs.canStep(1)}
        if (renderer() === 'monaco' && state.unified) {
            const n = state.unified.getLineChanges()?.length || 0
            return {count: n, prev: n > 0, next: n > 0}
        }
    }
    return {count: 0, prev: false, next: false}
}

function stepDiff(dir) {
    // past the last difference: go on to the next file, as the IDE does on a second F7
    if (isShown('md')) {
        const next = state.mdCur + dir
        if (next < 0 || next >= (state.mdMarks?.length || 0)) stepFile(dir)
        else markCurrent(next)
    } else if (renderer() === 'sbs' && state.sbs) {
        if (!state.sbs.step(dir)) stepFile(dir)
    } else if (state.unified) {
        state.unified.goToDiff(dir > 0 ? 'next' : 'previous')
    }
    updateToolbar()
}

function updateToolbar() {
    if (!shellBuilt) return
    const d = diffInfo()
    const loading = $('#loading-bar').classList.contains('on')
    const first = state.index <= 0, last = state.index >= state.order.length - 1
    $('#diff-count').textContent = loading ? '' : state.tooLarge ? 'Too large to compare' : d.count === 0 ? 'No differences' : plural(d.count, 'difference')
    $('#btn-prev-diff').disabled = !d.prev && first
    $('#btn-next-diff').disabled = !d.next && last
    $('#btn-prev-file').disabled = first
    $('#btn-next-file').disabled = last
    const cur = isShown('md') ? state.mdCur ?? -1 : renderer() === 'sbs' && isShown('sbs') ? state.sbs?.currentIndex() ?? -1 : -1
    $('#st-pos').textContent = cur >= 0 && d.count ? `Difference ${cur + 1} of ${d.count}` : ''
}

function setLoading(on) {
    $('#loading-bar')?.classList.toggle('on', on)
}

function onKey(e) {
    if ($('#dialog').open || state.palette?.isOpen) return
    const k = e.key.toLowerCase()
    const mod = e.metaKey || e.ctrlKey
    // Find Action (Ctrl/⌘+Shift+A), Go to File (Ctrl/⌘+P, Ctrl/⌘+Shift+O), Search Everywhere (Ctrl/⌘+K)
    if (mod && !e.altKey && (e.shiftKey ? k === 'a' || k === 'o' : k === 'p' || k === 'k')) {
        e.preventDefault()
        return state.palette.open(k === 'a' ? 'actions' : k === 'k' ? 'all' : 'files')
    }
    if (e.target.closest?.('input, textarea') && !e.target.closest('.monaco-editor')) return
    // the editor font: Ctrl/⌘ + = − 0 (instead of zooming the page), or Alt+Shift+. / , as in the IDE
    if ((mod && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) || (e.altKey && e.shiftKey && (e.code === 'Period' || e.code === 'Comma'))) {
        e.preventDefault()
        return changeFont(e.key === '0' ? 0 : (e.key === '=' || e.key === '+' || e.code === 'Period') ? 1 : -1)
    }
    // typing in the editable head: only F7 / Shift+F7 stay shortcuts
    if (e.key !== 'F7' && state.editing && state.editableFile && e.target.closest?.('.sbs-right, .editor.modified')) return
    if (e.key === 'F7') {
        e.preventDefault()
        stepDiff(e.shiftKey ? -1 : 1)
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        stepFile(e.key === 'ArrowRight' ? 1 : -1)
    } else if (k === 'v' && !mod && !e.altKey) {
        const f = currentFile()
        if (f) { e.preventDefault(); toggleViewed(f, !state.viewed.has(f.path)) }
    } else if (e.key === 'Escape') {
        closeMenu()
        closeDrawer()
    }
}

const glyph = (icon) => `<span class="fi fi-glyph pal-ai">${icon}</span>`

function actionItems() {
    const s = settings
    const f = currentFile()
    const t = state.target
    const A = (label, run, extra = {}) => ({label, run, icon: glyph(extra.ic || icons.gear), ...extra})
    const toggle = (k, label) => A(label, () => changeSetting(k), {toggle: s[k]})
    const options = (k, title, labels) => labels.map(([v, l]) => A(`${title}: ${l}`, () => changeSetting(k, v), {toggle: s[k] === v}))
    return [
        A('Next Difference', () => stepDiff(1), {hint: 'F7', ic: icons.down}),
        A('Previous Difference', () => stepDiff(-1), {hint: '⇧F7', ic: icons.up}),
        A('Next File', () => stepFile(1), {hint: 'Alt+→', ic: icons.right}),
        A('Previous File', () => stepFile(-1), {hint: 'Alt+←', ic: icons.left}),
        f && A(state.viewed.has(f.path) ? 'Unmark File as Viewed' : 'Mark File as Viewed', () => toggleViewed(f, !state.viewed.has(f.path)), {hint: 'V', ic: icons.check}),
        A('Side-by-Side Viewer', () => setView('sbs'), {toggle: viewMode() === 'sbs', ic: icons.sideBySide}),
        A('Unified Viewer', () => setView('unified'), {toggle: viewMode() === 'unified', ic: icons.unified}),
        toggle('align', 'Align Changes In Side-by-Side Diff'),
        toggle('syncScroll', 'Synchronize Scrolling'),
        ...options('ignore', 'Ignore Differences', [['none', 'None'], ['trim', 'Trim Whitespaces'], ['all', 'Ignore Whitespaces']]),
        ...options('highlight', 'Highlighting Differences', [['lines', 'Lines'], ['words', 'Words'], ['none', 'None']]),
        toggle('collapseUnchanged', 'Collapse Unchanged Fragments'),
        toggle('wordWrap', 'Soft-Wrap'),
        A('Markdown Preview', () => toggleMdPreview(), {toggle: s.mdPreview, ic: icons.eye}),
        state.cs?.commits?.length && A('Show Log', () => showLog(), {ic: icons.log}),
        A('Open Another Pull Request…', () => openPrDialog(), {ic: icons.folder}),
        A('Download for Offline…', () => offlineDialog(), {ic: icons.download}),
        state.cs?.pr && A('View Timeline', () => openTimeline(), {ic: icons.comment}),
        state.edits.size && A('Commit…', () => openCommitPanel(), {ic: icons.commit}),
        state.editableFile && A(state.editing ? 'Stop Editing' : 'Edit File', () => setEditing(!state.editing), {ic: icons.pencil}),
        A('Increase Font Size', () => changeFont(1), {hint: `${MOD}=`, sub: `editor, now ${fontSize()}px`}),
        A('Decrease Font Size', () => changeFont(-1), {hint: `${MOD}−`}),
        A('Reset Font Size', () => changeFont(0), {hint: `${MOD}0`}),
        A('Expand All', () => state.tree.collapseAll(false), {ic: icons.expand}),
        A('Collapse All', () => state.tree.collapseAll(true), {ic: icons.collapse}),
        A('Show Diff', () => setTab('changes'), {ic: icons.changes}),
        A('Pull Requests', showPrList, {sub: repoName(t), ic: icons.pr}),
        A('Changed Files', () => { setSidePanel('changes'); openDrawer() }, {ic: icons.commit}),
        A(state.cs?.pr ? 'Open PR on GitHub' : 'Open on GitHub', () => window.open($('#btn-github').href, '_blank', 'noopener'), {ic: icons.github}),
        ...openOnGitHubItems().map((it) => A(it.label.replace(/<[^>]+>/g, '').replace(/^\s+/, ''), it.action, {ic: icons.external})),
        A('Reload', () => reloadTarget(), {ic: icons.refresh}),
        ...THEMES.map((th) => A(`Theme: ${th.name}`, () => setThemeId(th.id), {toggle: s.theme === th.id, sub: th.dark ? 'dark' : 'light'})),
        A('GitHub Access: Sign In or Token…', tokenDialog, {ic: icons.lock}),
        A('Start Page', () => go(location.pathname), {ic: icons.folder}),
    ].filter(Boolean)
}

function setupPalette() {
    const sources = {
        files: {
            title: 'Files', limit: 8,
            items: () => state.order.map((f) => {
                const parts = f.path.split('/')
                const name = parts.pop()
                return {label: name, sub: parts.join('/'), alt: f.path, icon: fileIcon(f.path), cls: `st-${f.status}`,
                    hint: state.viewed.has(f.path) ? '✓ viewed' : '', run: () => selectFile(f.path)}
            }),
        },
        actions: {title: 'Actions', limit: 8, items: actionItems},
        commits: {
            title: 'Commits', limit: 5,
            items: () => (state.cs?.commits || []).map((c) => ({
                label: subject(c),
                sub: `${short(c.sha)} · ${commitAuthor(c)} · ${formatWhen(commitDate(c))}`,
                alt: c.sha, icon: glyph(icons.commit), run: () => openCommitSpec(c.sha),
            })),
        },
        prs: {
            title: 'Pull Requests', remote: true,
            items: async (q) => (await listPullRequests(state.target.owner, state.target.repo, {state: 'open', text: q})).map((p) => ({
                label: p.title, sub: `#${p.number} · ${p.user || ''}${p.draft ? ' · draft' : ''}`, icon: glyph(icons.pr),
                run: () => navigate(prTarget(p.number)),
            })),
        },
    }
    state.palette = new Palette(sources, {tabs: [
        {key: 'all', title: 'All'}, {key: 'files', title: 'Files'}, {key: 'actions', title: 'Actions'},
        {key: 'commits', title: 'Commits'}, {key: 'prs', title: 'Pull Requests'},
    ]})
    onDoubleShift(() => { if (!$('#app').hidden && !$('#dialog').open) state.palette.toggle() })
    $('#btn-search').onclick = () => state.palette.open()
}

applyThemeCss(themeById(settings.theme))
installTooltips()
// a sandboxed page has no service worker: even reading navigator.serviceWorker throws there
try { navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('No offline app', e)) } catch { /* no offline app here */ }
window.addEventListener('popstate', () => route())
if (takeSignInToken()) getViewer().then((me) => toast(`Signed in to GitHub as ${me.login}`)).catch(() => {})
route()
