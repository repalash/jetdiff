import {fileIcon, icons} from './icons.js'
import {baseName, doubleClicks, esc, plural} from './util.js'

const cmp = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true})

// Chains of single directories are compacted into one row ("tests/e2e"), as in the IDE's Changes view.
function buildTree(files) {
    const root = {name: '', path: '', dirs: new Map(), files: []}
    for (const f of files) {
        const parts = f.path.split('/')
        let node = root
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i]
            if (!node.dirs.has(key)) node.dirs.set(key, {name: key, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: []})
            node = node.dirs.get(key)
        }
        node.files.push(f)
    }
    const finish = (node) => {
        const dirs = [...node.dirs.values()].map((d) => {
            while (d.files.length === 0 && d.dirs.size === 1) {
                const only = [...d.dirs.values()][0]
                d = {...only, name: d.name + '/' + only.name}
            }
            return d
        })
        dirs.forEach(finish)
        node.children = dirs.sort((a, b) => cmp(a.name, b.name))
        node.files.sort((a, b) => cmp(baseName(a.path), baseName(b.path)))
        node.count = node.files.length + dirs.reduce((s, d) => s + d.count, 0)
    }
    finish(root)
    return root
}

function flattenTree(root) {
    const out = []
    const walk = (n) => {
        n.children.forEach(walk)
        out.push(...n.files)
    }
    walk(root)
    return out
}

const ROOT_KEY = '|root'
const dirKey = (d) => d.path + '|' + d.name

const STATUS_LABEL = {added: 'Added', removed: 'Deleted', modified: 'Modified', renamed: 'Renamed', copied: 'Copied', changed: 'Changed'}

export class FileTree {
    /**
     * `onToggleViewed` adds a Viewed slot to each file; with `checks` the slot is a checkbox (files to include in a
     * commit) and `viewed` means checked.
     */
    constructor(el, {onSelect, onOpen = null, onToggleViewed = null, checks = false, rootLabel = ''}) {
        this.el = el
        this.onSelect = onSelect
        this.onOpen = onOpen
        this.onToggleViewed = onToggleViewed
        this.checks = checks
        this.rootLabel = rootLabel
        this.edited = new Set() // edited here and not committed yet
        this.collapsed = new Set()
        this.selected = null
        this.viewed = new Set()
        const isDouble = doubleClicks()
        el.addEventListener('click', (e) => {
            const row = e.target.closest('.tr')
            if (!row) return
            if (e.target.closest('.tvd') && this.onToggleViewed) {
                e.stopPropagation()
                return this.onToggleViewed(row.dataset.file)
            }
            if (row.dataset.dir !== undefined) {
                const p = row.dataset.dir
                this.collapsed.has(p) ? this.collapsed.delete(p) : this.collapsed.add(p)
                this.render()
            } else if (row.dataset.file) {
                const path = row.dataset.file
                if (isDouble(path) && this.onOpen) this.onOpen(path)
                else this.onSelect(path)
            }
        })
    }

    setFiles(files) {
        this.root = buildTree(files)
        this.order = flattenTree(this.root)
        this.render()
    }

    /** Stops rendering until the next setFiles (the owner shows its own message in the element). */
    clear() {
        this.root = null
        this.order = []
    }

    setEdited(paths) {
        this.edited = new Set(paths)
        this.render()
    }

    setViewed(viewed) {
        this.viewed = viewed
        this.render()
    }

    select(path) {
        this.selected = path
        for (const key of [...this.collapsed]) {
            const dir = key.split('|')[0]
            if (key === ROOT_KEY || path.startsWith(dir + '/')) this.collapsed.delete(key)
        }
        this.render()
        this.el.querySelector('.tr.sel')?.scrollIntoView({block: 'nearest'})
    }

    collapseAll(collapse) {
        this.collapsed.clear()
        if (collapse) {
            const walk = (n) => n.children.forEach((d) => { this.collapsed.add(dirKey(d)); walk(d) })
            walk(this.root)
        }
        this.render()
    }

    render() {
        if (!this.root) return
        const rows = []
        const dirRow = (label, key, depth, count, open) =>
            `<div class="tr tr-dir" data-dir="${esc(key)}" style="--d:${depth}">
                <span class="tw">${open ? icons.chevronDown : icons.chevronRight}</span>
                <span class="fi fi-glyph fi-folder">${icons.folder}</span>
                ${label ? `<span class="tn">${esc(label)}</span>` : ''}<span class="tc">${plural(count, 'file')}</span>
            </div>`
        const walk = (node, depth) => {
            for (const d of node.children) {
                const key = dirKey(d)
                const open = !this.collapsed.has(key)
                rows.push(dirRow(d.name, key, depth, d.count, open))
                if (open) walk(d, depth + 1)
            }
            for (const f of node.files) {
                const viewed = this.viewed.has(f.path)
                const title = `${STATUS_LABEL[f.status] || f.status}: ${f.prevPath ? f.prevPath + ' → ' : ''}${f.path}  (+${f.additions} −${f.deletions})`
                const slot = !this.onToggleViewed ? ''
                    : this.checks ? `<span class="tvd tck" title="${viewed ? 'Included in the commit' : 'Not included'}"><i class="tvd-box">${viewed ? icons.check : ''}</i></span>`
                        : `<span class="tvd" title="${viewed ? 'Viewed: click to unmark' : 'Mark as viewed'}"><i class="tvd-dot"></i><i class="tvd-box">${viewed ? icons.check : ''}</i></span>`
                const edited = this.edited.has(f.path)
                rows.push(`<div class="tr tr-file st-${f.status}${f.path === this.selected ? ' sel' : ''}${viewed ? ' viewed' : ''}${edited ? ' edited' : ''}" data-file="${esc(f.path)}" style="--d:${depth}" title="${esc(title)}${edited ? ' · edited here, not committed' : ''}">
                    <span class="tw"></span>${this.checks ? slot : ''}${fileIcon(f.path)}<span class="tn">${esc(baseName(f.path))}</span>${edited ? '<span class="ted" title="Edited here, not committed"></span>' : ''}${this.checks ? '' : slot}
                </div>`)
            }
        }
        const rootOpen = !this.collapsed.has(ROOT_KEY)
        rows.push(dirRow(this.rootLabel, ROOT_KEY, 0, this.root.count, rootOpen))
        if (rootOpen) walk(this.root, 1)
        this.el.innerHTML = rows.join('')
    }
}
