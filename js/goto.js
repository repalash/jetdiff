// Go to Declaration in the editors, as in the IDE: ⌘/Ctrl-hover underlines a name, ⌘/Ctrl-click goes to its
// declaration, and several declarations show as a list to choose from (Choose Declaration).

import {MAC} from './keymap.js'
import {isName} from './declarations.js'
import {fileIcon} from './icons.js'
import {esc} from './util.js'

const held = (e) => MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey

/** The name at `position` of the editor's model: Monaco's word, or null when it is not a name. */
export function nameAt(ed, position) {
    const w = ed.getModel()?.getWordAtPosition(position)
    return w && isName(w.word) ? w : null
}

/** Underlines the name under the mouse while ⌘ (Ctrl elsewhere) is held, and calls `go(ed, position)` on a click. */
export function attachGoTo(monaco, ed, go) {
    const deco = ed.createDecorationsCollection()
    let last = null // the last mouse move over the text: {position, held}
    let shown = '' // the underlined name's line:column, '' for none
    const show = () => {
        const w = last?.held && nameAt(ed, last.position)
        const at = w ? `${last.position.lineNumber}:${w.startColumn}` : ''
        // a decoration change re-renders the line, and Monaco drops a mousedown that comes before that render
        if (at === shown) return
        shown = at
        deco.set(w ? [{range: new monaco.Range(last.position.lineNumber, w.startColumn, last.position.lineNumber, w.endColumn), options: {inlineClassName: 'jd-goto'}}] : [])
        ed.getDomNode()?.classList.toggle('jd-goto-on', !!w)
    }
    const text = (e) => e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && e.target.position
    let down = null
    ed.onMouseMove((e) => {
        last = text(e) ? {position: e.target.position, held: held(e.event)} : null
        show()
    })
    ed.onMouseLeave(() => { last = null; show() })
    // on the window: the editor under the mouse need not have the focus
    const key = (e) => { if (last && (e.key === 'Meta' || e.key === 'Control')) { last.held = e.type === 'keydown' && held(e); show() } }
    addEventListener('keydown', key, true)
    addEventListener('keyup', key, true)
    addEventListener('blur', () => { if (last) { last.held = false; show() } })
    ed.onMouseDown((e) => { down = e.event.leftButton && held(e.event) && text(e) && nameAt(ed, e.target.position) ? e.target.position : null })
    ed.onMouseUp((e) => {
        const at = down
        down = null
        if (at && text(e) && e.target.position.lineNumber === at.lineNumber && nameAt(ed, e.target.position)?.startColumn === nameAt(ed, at)?.startColumn) {
            last = null
            show()
            go(ed, at)
        }
    })
    ed.onDidChangeModel(() => deco.clear())
}

let popup = null

export const choosing = () => !!popup

function close() {
    popup?.remove()
    popup = null
    document.removeEventListener('pointerdown', outside, true)
}

function outside(e) {
    if (!popup?.contains(e.target)) close()
}

/**
 * The IDE's Choose Declaration: a list at the name in the editor. `items`: [{path, line, text, note}], `word` is shown
 * bold in each line's text; `choose(item)` runs on Enter or a click, and Escape closes.
 */
export function chooseDeclaration(ed, position, word, items, choose) {
    close()
    const box = ed.getDomNode().getBoundingClientRect()
    const at = ed.getScrolledVisiblePosition(position)
    const mark = (t) => esc(t).replace(new RegExp(`(?<![\\w$])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g'), '<b>$&</b>')
    const el = popup = document.createElement('div')
    el.className = 'menu decl'
    el.tabIndex = -1
    el.innerHTML = `<div class="menu-html">Choose Declaration of <b>${esc(word)}</b></div>` + items.map((it, i) => `
        <button class="menu-item decl-item${i ? '' : ' sel'}" data-i="${i}">${fileIcon(it.path)}
            <span class="decl-text">${mark(it.text)}</span>
            <span class="decl-where">${esc(it.path.split('/').pop())}:${it.line}${it.note ? ` <span class="decl-note">${esc(it.note)}</span>` : ''}</span></button>`).join('')
    document.body.appendChild(el)
    const y = box.top + at.top + at.height + 2
    el.style.left = Math.max(8, Math.min(box.left + at.left, innerWidth - el.offsetWidth - 8)) + 'px'
    el.style.top = (y + el.offsetHeight > innerHeight - 8 ? Math.max(8, box.top + at.top - el.offsetHeight - 2) : y) + 'px'
    let sel = 0
    const rows = [...el.querySelectorAll('.decl-item')]
    const paint = () => rows.forEach((r, i) => { r.classList.toggle('sel', i === sel); if (i === sel) r.scrollIntoView({block: 'nearest'}) })
    const pick = (i) => { close(); choose(items[i]) }
    el.addEventListener('click', (e) => { const b = e.target.closest('.decl-item'); if (b) pick(+b.dataset.i) })
    el.addEventListener('pointermove', (e) => { const b = e.target.closest('.decl-item'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; paint() } })
    el.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
        else if (e.key === 'Enter') return e.preventDefault(), pick(sel)
        else if (e.key === 'Escape') { close(); ed.focus() }
        else return
        e.preventDefault()
        paint()
    })
    el.focus()
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
}
