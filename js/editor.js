import {THEMES} from './themes.js'

// The libraries come from the site, at the versions index.html's import map names (tools/site.mjs copies them)
const MONACO_BASE = import.meta.resolve('monaco-editor/min/vs')
// Monaco's worker finds the rest of Monaco from its own URL
const WORKER_URL = `${MONACO_BASE}/base/worker/workerMain.js`
// Shiki's grammars and themes are imported by file: its own loaders name them without the extension, which only a
// bundler resolves
const grammar = (id) => import(`@shikijs/langs/dist/${id}.mjs`)
const shikiTheme = (id) => import(`@shikijs/themes/dist/${id}.mjs`)

export {THEMES}
export const DEFAULT_THEME = 'material-darker'

export let MONACO_THEME = 'jd-' + DEFAULT_THEME

// the editors' hovers: only TypeScript's and JavaScript's have something to show (typescript.js), after a pause as
// the IDE's quick documentation on mouse hover; none on a touch screen, where a tap would show them
export const HOVER = {enabled: matchMedia('(hover: hover)').matches, delay: 500}

// the current variant's colors, updated in place by applyThemeCss (other modules hold these objects)
export const DIFF_COLORS = {...THEMES[0].diff}
export const EDITOR_COLORS = {...THEMES[0].editor}

const selStyle = document.createElement('style')
document.head.appendChild(selStyle)
const selClasses = new Set()
function selFromClass(px) {
    const name = `jd-sel-x${px}`
    if (!selClasses.has(name)) {
        selClasses.add(name)
        selStyle.sheet.insertRule(`.monaco-editor .view-overlays .jd-sel.${name} { margin-left: ${px}px; }`)
    }
    return name
}

// Monaco ends a selected line at its last character; the IDE paints a multi-line selection to the editor's right edge
export function fullWidthSelection(monaco, editor) {
    const deco = editor.createDecorationsCollection()
    const update = () => {
        const out = []
        for (const s of editor.getSelections() || []) {
            if (s.startLineNumber === s.endLineNumber) continue
            const first = s.startLineNumber
            const x = s.startColumn > 1 ? Math.round(editor.getOffsetForColumn(first, s.startColumn)) : 0
            out.push({range: new monaco.Range(first, 1, first, 1), options: {isWholeLine: true, className: x ? `jd-sel ${selFromClass(x)}` : 'jd-sel'}})
            if (s.endLineNumber - 1 > first)
                out.push({range: new monaco.Range(first + 1, 1, s.endLineNumber - 1, 1), options: {isWholeLine: true, className: 'jd-sel'}})
        }
        deco.set(out)
    }
    editor.onDidChangeCursorSelection(update)
    editor.onDidChangeModel(() => deco.clear())
    return deco
}

let monacoReady
let highlighter
const registered = new Map() // shiki lang id -> monaco language id
const aliases = new Map() // alias/extension -> shiki lang id

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src
        s.onload = resolve
        s.onerror = () => reject(new Error('Failed to load ' + src))
        document.head.appendChild(s)
    })
}

export function loadMonaco() {
    return monacoReady ??= (async () => {
        const shikiReady = loadShiki()
        await loadScript(`${MONACO_BASE}/loader.js`)
        window.require.config({paths: {vs: MONACO_BASE}})
        window.MonacoEnvironment = {getWorkerUrl: () => WORKER_URL}
        const monaco = await new Promise((resolve, reject) => window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject))
        await shikiReady
        // the code font may arrive after Monaco measured it
        document.fonts?.ready.then(() => monaco.editor.remeasureFonts())
        return monaco
    })()
}

async function loadShiki() {
    const [{createHighlighterCore}, {createJavaScriptRegexEngine}, {bundledLanguagesInfo}] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
        import('shiki/langs'),
    ])
    highlighter = await createHighlighterCore({
        themes: [],
        langs: [],
        engine: createJavaScriptRegexEngine({forgiving: true}),
    })
    for (const info of bundledLanguagesInfo) {
        aliases.set(info.id, info.id)
        for (const a of info.aliases || []) aliases.set(a, info.id)
    }
}

// Shiki's own languages, which have no grammar
const PLAIN = new Set(['plaintext', 'txt', 'text', 'plain', 'ansi'])

// a bundled language's id (an alias names one); anything else has no grammar file to import
function loadLanguage(id) {
    if (PLAIN.has(id)) return highlighter.loadLanguage(id)
    if (aliases.get(id) !== id) throw new Error(`No grammar for ${id}`)
    return highlighter.loadLanguage(grammar(id))
}

const hex = (c) => (c || '').replace('#', '').slice(0, 6)

const baseThemes = {}
// Shiki's Material theme colors the scopes the IDE scheme does not map
function baseTheme(dark) {
    const id = dark ? 'material-theme-darker' : 'material-theme-lighter'
    return baseThemes[id] ??= shikiTheme(id).then((m) => m.default)
}

export function themeById(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0]
}

function onColor(hexColor) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#000000' : '#ffffff'
}

/** Sets the page's colors (CSS variables) for a theme; works before Monaco loads. */
export function applyThemeCss(theme) {
    const u = theme.ui, e = theme.editor, d = theme.diff, st = theme.status
    const a = (c, alpha) => (c.length === 7 ? c + alpha : c)
    const vars = {
        '--bg': u.bg, '--bg2': u.cs, '--bg-hover': u.button, '--bg-sel-focus': u.table,
        '--border': u.border, '--border2': u.hl, '--bg-on': u.hl, '--bg-tab': u.second, '--popup': u.second,
        '--popup-sel': u.selBg, '--fg': u.fg, '--fg-strong': u.white, '--fg-dim': u.text, '--fg-faint': u.dis,
        '--accent': u.accent, '--accent-bg': a(u.accent, '30'), '--on-accent': onColor(u.accent.slice(0, 7)),
        '--icon': u.fg, '--icon-dim': u.text, '--added': st.added, '--modified': st.modified, '--deleted': st.deleted,
        '--renamed': u.blue, '--danger': u.red, '--ed-bg': e.bg, '--sel': e.selection,
        '--d-mod': d.modified, '--d-mod-w': d.modifiedWord, '--d-ins': d.inserted, '--d-ins-w': d.insertedWord,
        '--d-del': d.deleted, '--d-del-w': d.deletedWord,
    }
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v)
    root.style.colorScheme = theme.dark ? 'dark' : 'light'
    root.dataset.theme = theme.dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', u.bg)
    Object.assign(DIFF_COLORS, d)
    Object.assign(EDITOR_COLORS, e)
}

/** Applies a theme to the page and to Monaco. Open models keep their old tokens until the caller reopens the file. */
export async function applyTheme(monaco, theme) {
    applyThemeCss(theme)
    const name = 'jd-' + theme.id
    if (!highlighter.getLoadedThemes().includes(name)) {
        const base = await baseTheme(theme.dark)
        await highlighter.loadTheme({
            ...base, name, type: theme.dark ? 'dark' : 'light', fg: theme.editor.fg, bg: theme.editor.bg,
            colors: {...base.colors, 'editor.background': theme.editor.bg, 'editor.foreground': theme.editor.fg},
            tokenColors: [...(base.tokenColors || base.settings || []), ...theme.tokens],
        })
    }
    const {colorMap} = highlighter.setTheme(name)
    const rules = [{token: '', foreground: hex(theme.editor.fg)}]
    const styles = ['', 'italic', 'bold', 'italic bold', 'underline', 'italic underline', 'bold underline', 'italic bold underline']
    colorMap.forEach((c, i) => {
        if (!c) return
        rules.push({token: `c${i}`, foreground: hex(c)})
        for (let s = 1; s < 8; s++) rules.push({token: `c${i}.s${s}`, foreground: hex(c), fontStyle: styles[s]})
    })
    const e = theme.editor, d = theme.diff, u = theme.ui
    const slider = theme.dark ? '#ffffff' : '#000000'
    monaco.editor.defineTheme(name, {
        base: theme.dark ? 'vs-dark' : 'vs',
        inherit: true,
        rules,
        colors: {
            'editor.background': e.bg,
            'editor.foreground': e.fg,
            'editorGutter.background': e.gutter,
            'editor.lineHighlightBackground': '#00000000',
            'editor.lineHighlightBorder': '#00000000',
            'editorLineNumber.foreground': e.lineNumber,
            'editorLineNumber.activeForeground': e.lineNumberCaret,
            'editor.selectionBackground': e.selection,
            'editor.inactiveSelectionBackground': e.selection,
            'editor.selectionHighlightBackground': '#00000000',
            'editorCursor.foreground': e.caret,
            'editorIndentGuide.background1': e.indentGuide,
            'editorWidget.background': u.second,
            'editorWidget.border': u.hl,
            'scrollbar.shadow': '#00000000',
            'scrollbarSlider.background': slider + '1f',
            'scrollbarSlider.hoverBackground': slider + '33',
            'scrollbarSlider.activeBackground': slider + '44',
            'editorOverviewRuler.border': '#00000000',
            'diffEditor.insertedLineBackground': d.inserted,
            'diffEditor.insertedTextBackground': d.insertedWord + 'cc',
            'diffEditor.removedLineBackground': d.deleted,
            'diffEditor.removedTextBackground': d.deletedWord + 'cc',
            'diffEditor.border': e.separator,
            'diffEditor.diagonalFill': u.border,
            'diffEditor.unchangedRegionBackground': e.collapsed || u.cs,
            'diffEditor.unchangedRegionForeground': u.text,
            'diffEditorGutter.insertedLineBackground': d.inserted,
            'diffEditorGutter.removedLineBackground': d.deleted,
            'diffEditorOverview.insertedForeground': d.insertedRuler,
            'diffEditorOverview.removedForeground': d.deletedRuler,
        },
    })
    MONACO_THEME = name
    monaco.editor.setTheme(name)
}

const EXT = {
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'jsx', md: 'markdown', mdx: 'mdx', json: 'json', jsonc: 'jsonc', json5: 'json5', yml: 'yaml', yaml: 'yaml', html: 'html',
    htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less', glsl: 'glsl', frag: 'glsl', vert: 'glsl', vs: 'glsl',
    fs: 'glsl', comp: 'glsl', wgsl: 'wgsl', hlsl: 'hlsl', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', kts: 'kotlin', swift: 'swift', c: 'c', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', mm: 'objective-cpp',
    m: 'objective-c', cs: 'csharp', php: 'php', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', vue: 'vue',
    svelte: 'svelte', xml: 'xml', svg: 'xml', plist: 'xml', toml: 'toml', sql: 'sql', lua: 'lua', dart: 'dart', ini: 'ini',
    cfg: 'ini', env: 'dotenv', graphql: 'graphql', gql: 'graphql', proto: 'proto', tf: 'terraform', gradle: 'groovy',
    ps1: 'powershell', bat: 'bat', r: 'r', scala: 'scala', ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell',
    clj: 'clojure', zig: 'zig', nix: 'nix', astro: 'astro', prisma: 'prisma', diff: 'diff', patch: 'diff', csv: 'csv',
    lock: 'yaml', txt: 'txt',
}
const NAMES = {
    dockerfile: 'docker', makefile: 'make', 'cmakelists.txt': 'cmake', '.gitignore': 'txt', '.npmignore': 'txt',
    '.env': 'dotenv', '.editorconfig': 'ini', '.gitattributes': 'txt', 'package-lock.json': 'json', '.babelrc': 'json',
    '.eslintrc': 'json', '.prettierrc': 'json', license: 'txt', notice: 'txt',
}

/** The Shiki language for a file name, or 'txt'. */
export function languageForPath(path) {
    const name = path.split('/').pop().toLowerCase()
    if (NAMES[name]) return NAMES[name]
    if (name.startsWith('dockerfile')) return 'docker'
    if (name.startsWith('.env')) return 'dotenv'
    const ext = name.includes('.') ? name.split('.').pop() : ''
    const id = EXT[ext] || aliases.get(ext)
    return id && (id === 'txt' || aliases.has(id)) ? id : 'txt'
}

const LANG_NAMES = {typescript: 'TypeScript', tsx: 'TypeScript JSX', javascript: 'JavaScript', jsx: 'JavaScript JSX', txt: 'Plain text', glsl: 'GLSL', json: 'JSON', markdown: 'Markdown'}
export function languageName(id) {
    return LANG_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1)
}

// Comment syntax by Shiki language id, for Monaco's Comment Line and Block Comment: [line comment, block comment]
const SLASHES = ['//', ['/*', '*/']]
const HASH = ['#']
const DASHES = ['--']
const MARKUP = [null, ['<!--', '-->']]
const COMMENT_GROUPS = [
    [SLASHES, 'typescript tsx javascript jsx java kotlin swift c cpp objective-c objective-cpp csharp go rust dart scala groovy glsl hlsl wgsl jsonc json5 php less scss sass stylus proto solidity d haxe apex qml vala v jsonnet odin'],
    [['//'], 'zig prisma'],
    [HASH, 'python yaml toml dotenv docker make perl r elixir gdscript tcl awk graphql fish nushell just crystal'],
    [['#', ['=begin', '=end']], 'ruby'],
    [['#', ['/*', '*/']], 'nix terraform hcl'],
    [['#', ['<#', '#>']], 'powershell'],
    [['#', ['#[[', ']]']], 'cmake'],
    [['#', ['###', '###']], 'coffee'],
    [['#', ['#=', '=#']], 'julia'],
    [['#', ['#[', ']#']], 'nim'],
    [['#'], 'shellscript'],
    [['--', ['/*', '*/']], 'sql plsql'],
    [['--', ['--[[', ']]']], 'lua'],
    [['--', ['{-', '-}']], 'haskell elm purescript'],
    [DASHES, 'ada vhdl'],
    [[';'], 'clojure racket asm ini fennel'],
    [[';', ['#|', '|#']], 'common-lisp scheme'],
    [['%'], 'erlang latex tex'],
    [['%', ['%{', '%}']], 'matlab'],
    [MARKUP, 'html xml markdown vue svelte astro vue-html'],
    [[null, ['/*', '*/']], 'css'],
    [[null, ['{/*', '*/}']], 'mdx'],
    [['//', ['(*', '*)']], 'fsharp'],
    [[null, ['(*', '*)']], 'ocaml'],
    [['REM'], 'bat'],
    [["'"], 'vb'],
    [['"'], 'viml'],
    [['!'], 'fortran-free-form'],
]
const COMMENTS = new Map(COMMENT_GROUPS.flatMap(([c, ids]) => ids.split(' ').map((id) => [id, c])))
const BRACKETS = [['{', '}'], ['[', ']'], ['(', ')']]
// a word there includes dashes (custom properties, class names), as Monaco's own CSS language has it
const DASHED_WORDS = /(-?\d*\.\d\w*)|([\w-]+)/g
const DASHED = new Set(['css', 'scss', 'sass', 'less', 'stylus'])

/** The comment syntax of a Shiki language id: {lineComment?, blockComment?}, or null when it has none. */
export function commentsOf(id) {
    const c = COMMENTS.get(id)
    return c ? {...c[0] && {lineComment: c[0]}, ...c[1] && {blockComment: c[1]}} : null
}

class TokenState {
    constructor(stack) { this.stack = stack }
    clone() { return new TokenState(this.stack) }
    equals(o) { return o instanceof TokenState && (o.stack === this.stack || !!(this.stack && o.stack && this.stack.equals(o.stack))) }
}

/** Loads a Shiki language's grammar; returns the Monaco language id that highlights with it. */
export async function ensureLanguage(monaco, id) {
    if (id === 'txt') return 'plaintext'
    if (registered.has(id)) return registered.get(id)
    const monId = 'jd-' + id
    try {
        await loadLanguage(id)
    } catch (e) {
        console.warn('No grammar for', id, e)
        registered.set(id, 'plaintext')
        return 'plaintext'
    }
    // a language id of our own, so Monaco's built-in language services (TS diagnostics etc.) stay out
    monaco.languages.register({id: monId})
    // the brackets also make Extend Selection grow to the enclosing block
    monaco.languages.setLanguageConfiguration(monId, {
        brackets: BRACKETS, ...commentsOf(id) && {comments: commentsOf(id)}, ...DASHED.has(id) && {wordPattern: DASHED_WORDS},
    })
    const grammar = highlighter.getLanguage(id)
    monaco.languages.setTokensProvider(monId, {
        getInitialState: () => new TokenState(null),
        tokenize(line, state) {
            // a minified line would take too long
            if (line.length > 20000) return {endState: state, tokens: [{startIndex: 0, scopes: ''}]}
            const r = grammar.tokenizeLine2(line, state.stack, 500)
            const tokens = []
            for (let j = 0; j < r.tokens.length; j += 2) {
                // vscode-textmate's token metadata: the foreground color index at bits 15-23, the font style at 11-14
                const meta = r.tokens[j + 1]
                const fgIdx = (meta & 0x00ff8000) >>> 15
                const style = ((meta & 0x00007800) >>> 11) & 7
                tokens.push({startIndex: r.tokens[j], scopes: style ? `c${fgIdx}.s${style}` : `c${fgIdx}`})
            }
            return {endState: new TokenState(r.ruleStack), tokens}
        },
    })
    registered.set(id, monId)
    return monId
}

/** Highlighted HTML for a Markdown code block, or null (Shiki not loaded, or an unknown language). */
export async function highlightCode(code, lang) {
    if (!highlighter) return null
    const l = String(lang).toLowerCase()
    const id = aliases.get(l) || EXT[l] || l
    try {
        if (!highlighter.getLoadedLanguages().includes(id)) await loadLanguage(id)
        return highlighter.codeToHtml(code, {lang: id, theme: MONACO_THEME})
    } catch {
        return null
    }
}

// the TypeScript service's worker module (typescript.js): loaded when first used, and kept by sw.js then
const TS_WORKER = `${MONACO_BASE}/language/typescript/tsWorker.js`
const TS_FAMILY = ['typescript', 'tsx', 'javascript', 'jsx']

/**
 * Loads both base themes, the grammars of `languages` and, for TypeScript or JavaScript, the TypeScript service, for
 * offline use (sw.js keeps the rest of the libraries).
 */
export async function preloadForOffline(monaco, languages) {
    await Promise.all([baseTheme(true), baseTheme(false)])
    for (const id of new Set(languages)) await ensureLanguage(monaco, id).catch(() => {})
    if (languages.some((id) => TS_FAMILY.includes(id))) await fetch(TS_WORKER).catch(() => {})
}
