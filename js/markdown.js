import {highlightCode} from './editor.js'

// what GitHub strips from Markdown too: no restyling the app, no forms, no frames; ids get GitHub's user-content- prefix
const PURIFY_OPTIONS = {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'dialog', 'iframe', 'frame', 'object', 'embed'],
    SANITIZE_NAMED_PROPS: true,
}

// The rich diff wraps changed characters in private-use characters in the Markdown source, renders it, then turns
// them into <ins> / <del> in the text (never in attributes).
const INS_S = '\uE000', INS_E = '\uE001', DEL_S = '\uE002', DEL_E = '\uE003'
const MARKS = /[\uE000-\uE003]/g
const HAS_MARK = /[\uE000-\uE003]/
const stripMarks = (s) => s.replace(MARKS, '')

const template = (html) => {
    const t = document.createElement('template')
    t.innerHTML = html
    return t
}

let libs
export function loadMarkdown() {
    libs ??= Promise.all([import('markdown-it'), import('dompurify')]).then(([m, p]) => {
        const md = new m.default({html: true, linkify: true})
        // the rich diff's marks must not end up inside a link address (encoded or punycoded); they stay in the text
        const normalize = md.normalizeLink.bind(md)
        md.normalizeLink = (url) => normalize(stripMarks(url))
        const validate = md.validateLink.bind(md)
        md.validateLink = (url) => validate(stripMarks(url))
        const purify = p.default
        purify.addHook('afterSanitizeAttributes', (node) => {
            const href = node.tagName === 'A' && node.getAttribute('href')
            if (href && !href.startsWith('#')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer') }
            // inputs only as task-list checkboxes
            if (node.tagName === 'INPUT') {
                if (node.getAttribute('type') !== 'checkbox') node.remove()
                else node.setAttribute('disabled', '')
            }
        })
        return {md, purify}
    })
    libs.catch(() => { libs = null })
    return libs
}

// GitHub's rendered bodies are sanitized already: this is a second guard
export async function sanitize(html) {
    const {purify} = await loadMarkdown()
    return purify.sanitize(html || '', PURIFY_OPTIONS)
}

const LIST = new Set(['bullet_list_open', 'ordered_list_open'])

// classify(start, end): 0-based source lines, end exclusive; map[i]: the source line of line i, 0 if put back
function markBlocks(tokens, classify, map) {
    const src = (i) => (map ? map[i] : i + 1)
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (!t.map || t.nesting === -1) continue
        let [a, b] = t.map
        if (t.type === 'list_item_open') {
            // the item's own lines: up to a nested list
            for (let j = i + 1; j < tokens.length && !(tokens[j].type === 'list_item_close' && tokens[j].level === t.level); j++)
                if (LIST.has(tokens[j].type) && tokens[j].map) { b = tokens[j].map[0]; break }
        } else if (t.level !== 0 || LIST.has(t.type)) continue
        // source lines for the connectors between the two sides
        let sl = 0, el = 0
        for (let k = a; k < b; k++) { const l = src(k); if (l) { sl ||= l; el = l } }
        if (sl && t.type !== 'html_block') { t.attrSet('data-sl', String(sl)); t.attrSet('data-el', String(el)) }
        const cls = classify?.(a, b)
        if (!cls) continue
        if (t.type === 'html_block') t.content = `<div class="${cls}">\n${t.content}\n</div>\n`
        else t.attrJoin('class', cls)
    }
}

/** Sanitized HTML. `classify` marks changed blocks; `link` and `image` resolve URLs (null keeps one). */
export async function renderMarkdown(text, {classify, link, image, marks = false, map = null} = {}) {
    const {md, purify} = await loadMarkdown()
    const env = {}
    const tokens = md.parse(text, env)
    markBlocks(tokens, classify, map)
    for (const t of tokens) {
        if (t.type !== 'inline' || !t.children) continue
        for (const c of t.children) {
            if (c.type === 'link_open' && link) { const r = link(c.attrGet('href') || ''); if (r) c.attrSet('href', r) }
            if (c.type === 'image' && image) { const r = image(c.attrGet('src') || ''); if (r) c.attrSet('src', r) }
        }
    }
    let html = md.renderer.render(tokens, md.options, env)
    // task lists, as on GitHub
    html = html.replace(/<li([^>]*)>(\s*<p>)?\[( |x|X)\]\s/g, (m, attrs, p, x) =>
        `<li${attrs.includes('class="') ? attrs.replace('class="', 'class="task ') : attrs + ' class="task"'}>${p || ''}<input type="checkbox" disabled${x === ' ' ? '' : ' checked'}> `)
    html = purify.sanitize(html, PURIFY_OPTIONS)
    if (!marks) return html
    const tpl = template(html)
    applyMarks(tpl.content)
    // again: removing the marks from attributes can complete a URL the first pass let through (java\uE000script:)
    return purify.sanitize(tpl.innerHTML, PURIFY_OPTIONS)
}

export async function highlightBlocks(el) {
    for (const code of el.querySelectorAll('pre > code[class*="language-"]')) {
        const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9)
        const html = lang && await highlightCode(code.textContent.replace(/\n$/, ''), lang)
        if (!html || !code.isConnected) continue
        const pre = template(html).content.firstElementChild
        for (const c of code.classList) if (c.startsWith('md-')) pre.classList.add(c)
        code.parentElement.replaceWith(pre)
    }
}

/** `{link, image}` resolvers for the relative URLs of the Markdown file `path` at `ref`. */
export function repoResolvers(owner, repo, ref, path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const resolve = (u) => {
        if (!u || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u)) return null
        const abs = new URL(u, 'https://x/' + (u.startsWith('/') ? '' : dir)).pathname.slice(1)
        return {path: abs, rest: u.includes('#') ? u.slice(u.indexOf('#')) : ''}
    }
    return {
        link: (u) => { const r = resolve(u); return r && `https://github.com/${owner}/${repo}/blob/${ref}/${r.path}${r.rest}` },
        // github.com/…/raw/… works for private repositories when the browser is signed in to GitHub
        image: (u) => { const r = resolve(u); return r && `https://github.com/${owner}/${repo}/raw/${ref}/${r.path}` },
    }
}

// block syntax a mark must not precede: quotes, list bullets / numbers (with a task box), headings
const SYNTAX = /^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/
// lines that get no marks: code fences and table separator rows
const NO_MARKS = /^\s*(?:```|~~~|\|?\s*:?-{3,}:?\s*(\||$))/

// link addresses, autolinks, bare URLs and HTML tags: a mark inside one would change the address, so it moves past it
const PROTECTED = /\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|https?:\/\/[^\s<>()\]]+|<\/?[a-z][^>]*>/gi

// character references (&amp; &#169; &#x1F600;): a mark inside one would show it as text, so it takes the whole of it
const ENTITY = /&(?:[a-z][a-z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-f]{1,6});/gi
const isEnd = (t) => t === INS_E || t === DEL_E

// inserts: [col, text] pairs, 0-based columns
function insertAt(line, inserts) {
    if (!inserts.length || NO_MARKS.test(line)) return line
    const min = line.match(SYNTAX)[0].length
    const guard = [...line.matchAll(PROTECTED)].map((m) => [m.index + (m[0].startsWith('](') ? 2 : 0), m.index + m[0].length])
    const entities = [...line.matchAll(ENTITY)].map((m) => [m.index, m.index + m[0].length])
    const place = (c, t) => {
        for (const [a, b] of guard) if (c > a && c < b) return b
        for (const [a, b] of entities) if (c > a && c < b) return isEnd(t) ? b : a
        return c
    }
    const at = inserts.map(([c, t], i) => [place(Math.max(min, Math.min(line.length, c)), t), t, i]).sort((a, b) => b[0] - a[0] || b[2] - a[2])
    for (const [c, t] of at) line = line.slice(0, c) + t + line.slice(c)
    return line
}

// [line, from, to) column segments of a character range (1-based lines and columns, end exclusive)
function segments(lines, sl, sc, el, ec) {
    const out = []
    for (let l = Math.max(1, sl); l <= el && l <= lines.length; l++) {
        const from = l === sl ? sc - 1 : 0, to = l === el ? ec - 1 : lines[l - 1].length
        if (to > from) out.push([l, from, to])
    }
    return out
}

const escapeMd = (s) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&')

// line -> {open, close}: the fence lines (1-based) of each line in a fenced code block
function fences(lines) {
    const out = new Map()
    let open = 0, marker = ''
    lines.forEach((line, i) => {
        const m = line.match(/^\s*(`{3,}|~{3,})/)
        if (!open && m) { open = i + 1; marker = m[1][0] }
        else if (open && m && m[1][0] === marker) {
            for (let l = open; l <= i + 1; l++) out.set(l, {open, close: i + 1})
            open = 0
        }
    })
    if (open) for (let l = open; l <= lines.length; l++) out.set(l, {open, close: lines.length})
    return out
}

/**
 * One side's Markdown with the changed words marked; `unified` (one page) also puts the removed words and blocks
 * back into the new side. Returns {text, map}: map[i] is the source line of line i, 0 for a line put back.
 */
export function richSource(oldText, newText, lineChanges, side, unified = false) {
    // the file's own private-use characters would read as marks
    oldText = stripMarks(oldText)
    newText = stripMarks(newText)
    const oldLines = oldText.split('\n'), newLines = newText.split('\n')
    const lines = side === 'old' ? oldLines : newLines
    const fenceOf = fences(lines)
    const oldFences = fences(oldLines)
    const push = (m, k, ...v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(...v) }
    const ins = new Map() // line -> [[col, text]]
    const add = (l, c, t) => push(ins, l, [c, t])
    const before = new Map(), after = new Map() // line -> lines put back
    const struck = (lines) => ['', '<div class="md-delblock">', '', ...lines, '', '</div>', '']
    const delBlock = (from, to) => struck(oldLines.slice(from - 1, to))
    const fenced = new Map() // fence close line -> old lines to put back after it
    for (const c of lineChanges) {
        const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
        // code in a fence gets no word marks (they would show as text); on one page its old lines follow the block
        const inFence = side === 'old'
            ? hasO && oldFences.has(c.originalStartLineNumber)
            : hasM ? fenceOf.has(c.modifiedStartLineNumber) : fenceOf.has(c.modifiedStartLineNumber) && fenceOf.get(c.modifiedStartLineNumber).close !== c.modifiedStartLineNumber
        if (inFence) {
            if (unified && side === 'new' && hasO) {
                const f = fenceOf.get(c.modifiedStartLineNumber)
                const old = oldLines.slice(c.originalStartLineNumber - 1, c.originalEndLineNumber)
                if (!fenced.has(f.close)) fenced.set(f.close, {open: lines[f.open - 1].trim(), lines: []})
                fenced.get(f.close).lines.push(...old)
            }
            continue
        }
        if (c.charChanges?.length && hasO && hasM) {
            for (const cc of c.charChanges) {
                const oldSegs = segments(oldLines, cc.originalStartLineNumber, cc.originalStartColumn, cc.originalEndLineNumber, cc.originalEndColumn)
                if (side === 'old') {
                    for (const [l, a, b] of oldSegs) { add(l, a, DEL_S); add(l, b, DEL_E) }
                    continue
                }
                if (unified) {
                    // the removed words, at the position of the change on the new side
                    const del = oldSegs.map(([l, a, b]) => oldLines[l - 1].slice(a, b)).join(' ')
                    // escaped as text, except inside an inline code span (where a backslash would show)
                    const line = newLines[cc.modifiedStartLineNumber - 1] || ''
                    const inCode = ((line.slice(0, cc.modifiedStartColumn - 1).match(/`/g) || []).length % 2) === 1
                    if (del.trim()) add(cc.modifiedStartLineNumber, cc.modifiedStartColumn - 1, DEL_S + (inCode ? del : escapeMd(del)) + DEL_E)
                }
                for (const [l, a, b] of segments(newLines, cc.modifiedStartLineNumber, cc.modifiedStartColumn, cc.modifiedEndLineNumber, cc.modifiedEndColumn)) { add(l, a, INS_S); add(l, b, INS_E) }
            }
        } else if (unified && side === 'new' && hasO) {
            // removed lines (or a change too large for word marks): the old lines, struck through, where they were
            push(hasM ? before : after, c.modifiedStartLineNumber, ...delBlock(c.originalStartLineNumber, c.originalEndLineNumber))
        }
    }
    for (const [close, {open, lines: old}] of fenced) {
        const fence = open.match(/^(`{3,}|~{3,})/)?.[1] || '```'
        push(after, close, ...struck([open, ...old, fence]))
    }
    const text = [], map = []
    const emit = (x, l = 0) => { text.push(x); map.push(l) }
    for (const x of after.get(0) || []) emit(x)
    lines.forEach((line, i) => {
        const l = i + 1
        for (const x of before.get(l) || []) emit(x)
        emit(insertAt(line, ins.get(l) || []), l)
        for (const x of after.get(l) || []) emit(x)
    })
    return {text: text.join('\n'), map}
}

// marks in attributes and code blocks are dropped
function applyMarks(root) {
    for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (HAS_MARK.test(a.value)) el.setAttribute(a.name, stripMarks(a.value))
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    let open = null // 'ins' | 'del'
    let block = null
    for (const node of nodes) {
        const s = node.nodeValue
        // a mark never runs past its block
        let top = node
        while (top.parentNode && top.parentNode !== root) top = top.parentNode
        if (top !== block) { block = top; open = null }
        const inPre = node.parentElement?.closest('pre')
        if (!HAS_MARK.test(s) && !open) continue
        if (inPre) { node.nodeValue = stripMarks(s); open = null; continue }
        const frag = document.createDocumentFragment()
        let buf = ''
        const flush = () => {
            if (!buf) return
            if (open) { const w = document.createElement(open); w.className = 'mdw'; w.textContent = buf; frag.appendChild(w) }
            else frag.appendChild(document.createTextNode(buf))
            buf = ''
        }
        for (const ch of s) {
            if (ch === INS_S || ch === DEL_S) { flush(); open = ch === INS_S ? 'ins' : 'del' }
            else if (ch === INS_E || ch === DEL_E) { flush(); open = null }
            else buf += ch
        }
        flush()
        node.replaceWith(frag)
    }
}
