// TypeScript and JavaScript: Go to Declaration and hover by Monaco's TypeScript language service, in its own worker
// (from the site, like Monaco's), with no diagnostics. The service reads the open file's model and, loaded on demand,
// the files it imports by a relative path, from the same repository at the same commit.

import {getFileContent, listDirectory} from './github.js'

export const TS_LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'jsx'])

// ts.ScriptTarget.ESNext, ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler, ts.JsxEmit.Preserve: the bundler
// resolution maps an import of ./a.js to a.ts and finds index files, as the projects' own tools do
const COMPILER_OPTIONS = {target: 99, module: 99, moduleResolution: 100, jsx: 1, allowJs: true, allowNonTsExtensions: true, noEmit: true}

/** Where a model's files come from, by its URI's root (scheme://authority): {owner, repo, ref, models: Set<uri>}. */
const roots = new Map()
const rootKey = (uri) => `${uri.scheme}://${uri.authority}`

/** Makes the TS service read the imports of models under `uri`'s root at `ref` of owner/repo. */
export function addRoot(uri, source) {
    roots.set(rootKey(uri), {...source, models: new Set(), loaded: new Map()})
}

/** Disposes what was loaded for `uri`'s root. */
export function dropRoot(monaco, uri) {
    const root = roots.get(rootKey(uri))
    if (!root) return
    roots.delete(rootKey(uri))
    for (const u of root.models) monaco.editor.getModel(u)?.dispose()
}

let worker
const getWorker = (monaco) => worker ??= monaco.editor.createWebWorker({
    moduleId: 'vs/language/typescript/tsWorker', label: 'typescript', keepIdleModels: true,
    createData: {compilerOptions: COMPILER_OPTIONS, extraLibs: {}, inlayHintsOptions: {}},
})

const pathOf = (uri) => uri.path.slice(1)

// the relative module specifiers of import and export statements, require() and import()
const IMPORT = /(?:\bimport\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*|\b(?:require|import)\s*\(\s*)['"](\.\.?\/[^'"\n]*|\.\.?)['"]/g
const REEXPORT = /\bexport\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*['"](\.\.?\/[^'"\n]*|\.\.?)['"]/g

function join(dir, spec) {
    const out = dir ? dir.split('/') : []
    for (const part of spec.split('/')) {
        if (part === '..') { if (!out.length) return null; out.pop() } else if (part && part !== '.') out.push(part)
    }
    return out.join('/')
}

const TS_FOR_JS = {'.js': ['.ts', '.tsx', '.d.ts'], '.jsx': ['.tsx'], '.mjs': ['.mts', '.d.mts'], '.cjs': ['.cts', '.d.cts']}
const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']

/** The files an import of `spec` from `from` may name, in the order the bundler resolution tries them. */
function candidates(from, spec) {
    const p = join(from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '', spec)
    if (p === null) return []
    const ext = p.match(/\.[cm]?[jt]sx?$/)?.[0]
    if (ext && TS_FOR_JS[ext]) return [...TS_FOR_JS[ext].map((e) => p.slice(0, -ext.length) + e), p]
    if (ext) return [p]
    return [...EXTENSIONS.map((e) => p + e), ...EXTENSIONS.map((e) => `${p}${p ? '/' : ''}index${e}`)]
}

const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''

/** The first of `paths` that is a file at the root's commit, or null. */
async function existing(root, paths) {
    for (const p of paths) {
        const names = await listDirectory(root.owner, root.repo, root.ref, dirOf(p)).catch(() => null)
        if (names?.has(p.slice(p.lastIndexOf('/') + 1))) return p
    }
    return null
}

/** Loads the files `text` (of `path`) imports into models of the root; their re-exports too, `depth` more levels. */
async function loadImports(monaco, base, root, path, text, depth, re = IMPORT) {
    const specs = new Set([...text.matchAll(re)].map((m) => m[1]))
    await Promise.all([...specs].map(async (spec) => {
        const key = path + '\0' + spec
        if (!root.loaded.has(key)) {
            root.loaded.set(key, (async () => {
                const file = await existing(root, candidates(path, spec))
                if (!file) return
                const uri = base.with({path: '/' + file})
                if (monaco.editor.getModel(uri)) return
                const c = await getFileContent(root.owner, root.repo, root.ref, file).catch(() => null)
                if (!c || c.binary || monaco.editor.getModel(uri) || !roots.has(rootKey(base))) return
                monaco.editor.createModel(c.text, 'plaintext', uri)
                root.models.add(uri)
                if (depth > 0) await loadImports(monaco, base, root, file, c.text, depth - 1, REEXPORT)
            })())
        }
        await root.loaded.get(key)
    }))
}

/** The service, with the model and what it imports synced to it; null for a model of no root. */
async function service(monaco, model) {
    const root = roots.get(rootKey(model.uri))
    if (!root) return null
    await loadImports(monaco, model.uri, root, pathOf(model.uri), model.getValue(), 3)
    return getWorker(monaco).withSyncedResources([model.uri, ...root.models])
}

const lineAt = (text, offset) => {
    const before = text.slice(0, offset)
    const line = before.split('\n').length
    return {lineNumber: line, column: offset - before.lastIndexOf('\n')}
}

/**
 * Where the TS service says the name at `position` is declared: [{path, ref, line, column}] in the repository, or
 * [{lib, text, line, column}] in TypeScript's library; [] when it finds none (or only the name itself, as for an
 * import from a package), null when the model has no root.
 */
export async function tsDefinitions(monaco, model, position) {
    const ts = await service(monaco, model)
    if (!ts || model.isDisposed()) return null
    const at = model.getOffsetAt(position)
    const defs = await ts.getDefinitionAtPosition(model.uri.toString(), at) || []
    const self = (d) => d.fileName === model.uri.toString() && d.textSpan.start <= at && at <= d.textSpan.start + d.textSpan.length
    if (defs.every(self)) return []
    const out = []
    for (const d of defs) {
        const m = monaco.editor.getModel(monaco.Uri.parse(d.fileName))
        const root = m && roots.get(rootKey(m.uri))
        if (root) {
            const p = m.getPositionAt(d.textSpan.start)
            out.push({path: pathOf(m.uri), ref: root.ref, line: p.lineNumber, column: p.column, text: m.getLineContent(p.lineNumber).trim()})
        } else if (/^lib\.[\w.]*d\.ts$/.test(d.fileName)) {
            const text = await ts.getScriptText(d.fileName)
            const p = lineAt(text, d.textSpan.start)
            out.push({lib: d.fileName, text, line: p.lineNumber, column: p.column, preview: text.split('\n')[p.lineNumber - 1].trim()})
        }
    }
    return out
}

const hovers = new Set()
// a {@link name} in documentation comes as parts: its name shows as code
const partsText = (parts) => (parts || []).map((p) => p.kind === 'link' ? '' : p.kind === 'linkName' ? `\`${p.text}\`` : p.text).join('')
const fence = (lang, code) => `\`\`\`${lang}\n${code}\n\`\`\``

/** Hovers from the TS service in the editors of Monaco language `languageId` (one of ours: see editor.js). */
export function registerHover(monaco, languageId) {
    if (hovers.has(languageId)) return
    hovers.add(languageId)
    monaco.languages.registerHoverProvider(languageId, {
        async provideHover(model, position) {
            const ts = await service(monaco, model).catch(() => null)
            if (!ts || model.isDisposed()) return null
            const info = await ts.getQuickInfoAtPosition(model.uri.toString(), model.getOffsetAt(position))
            if (!info || model.isDisposed()) return null
            const start = model.getPositionAt(info.textSpan.start), end = model.getPositionAt(info.textSpan.start + info.textSpan.length)
            const tags = (info.tags || []).map((t) => `*@${t.name}*${t.text?.length ? ' — ' + partsText(t.text) : ''}`)
            return {
                range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                contents: [{value: fence(languageId, partsText(info.displayParts))}, ...[partsText(info.documentation), ...tags].filter(Boolean).map((value) => ({value}))],
            }
        },
    })
}
