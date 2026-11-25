import {DIFF_COLORS, EDITOR_COLORS, fullWidthSelection} from './editor.js'

/**
 * Monaco line changes (1-based, `*EndLineNumber` 0 for an empty side) as 0-based half-open ranges
 * `{l0, l1, r0, r1, type, chars}`. An empty side is a point: l0 === l1 is the boundary after line l0.
 */
function normalizeChanges(lineChanges) {
    return (lineChanges || []).map((c) => {
        const insertion = c.originalEndLineNumber === 0
        const deletion = c.modifiedEndLineNumber === 0
        const l0 = insertion ? c.originalStartLineNumber : c.originalStartLineNumber - 1
        const l1 = insertion ? l0 : c.originalEndLineNumber
        const r0 = deletion ? c.modifiedStartLineNumber : c.modifiedStartLineNumber - 1
        const r1 = deletion ? r0 : c.modifiedEndLineNumber
        return {l0, l1, r0, r1, type: insertion ? 'ins' : deletion ? 'del' : 'mod', chars: c.charChanges || []}
    })
}

/** Maps a fractional 0-based line position from one side to the other through the changes, piecewise linearly. */
function mapPosition(changes, x, fromLeft) {
    let offset = 0
    for (const c of changes) {
        const a0 = fromLeft ? c.l0 : c.r0, a1 = fromLeft ? c.l1 : c.r1
        const b0 = fromLeft ? c.r0 : c.l0, b1 = fromLeft ? c.r1 : c.l1
        if (x < a0) return x + (b0 - a0)
        if (x < a1) return b0 + (x - a0) * (b1 - b0) / (a1 - a0)
        offset = b1 - a1
    }
    return x + offset
}

export class SideBySideViewer {
    constructor(container, monaco, {fontSize = 13, lineHeight = 20, fontFamily} = {}) {
        this.monaco = monaco
        this.changes = []
        this.lineHeight = lineHeight
        this.fontSize = fontSize
        this.fontFamily = fontFamily
        this.expect = {L: null, R: null}
        this.cur = -1
        this.userScrolled = true
        this.onScroll = null
        this.syncScroll = true
        this.highlight = 'words' // 'words' | 'lines' | 'none', as in the IDE's "Highlighting Differences"

        container.innerHTML = `
            <div class="sbs">
                <div class="sbs-head">
                    <div class="sbs-head-left"></div>
                    <div class="sbs-head-right"></div>
                </div>
                <div class="sbs-body">
                    <div class="sbs-ed sbs-left"></div>
                    <canvas class="sbs-divider"></canvas>
                    <div class="sbs-ed sbs-right"></div>
                </div>
            </div>`
        this.root = container.firstElementChild
        this.root.style.setProperty('--jd-lh', lineHeight + 'px')
        this.headLeft = this.root.querySelector('.sbs-head-left')
        this.headRight = this.root.querySelector('.sbs-head-right')
        this.canvas = this.root.querySelector('.sbs-divider')
        this.ctx = this.canvas.getContext('2d')

        const common = {
            readOnly: true,
            domReadOnly: true,
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 14,
            lineNumbersMinChars: 0,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            roundedSelection: false,
            fontFamily,
            fontSize,
            lineHeight,
            fontLigatures: false,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            contextmenu: false,
            occurrencesHighlight: 'off',
            selectionHighlight: false,
            renderWhitespace: 'none',
            guides: {indentation: false, bracketPairs: false},
            stickyScroll: {enabled: false},
            matchBrackets: 'never',
            unicodeHighlight: {ambiguousCharacters: false, invisibleCharacters: false},
            automaticLayout: true,
            wordWrap: 'off',
            links: false,
            hover: {enabled: false},
            codeLens: false,
            quickSuggestions: false,
            renderValidationDecorations: 'off',
            cursorBlinking: 'solid',
            fixedOverflowWidgets: true,
        }
        const scrollbar = {horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false, useShadows: false}
        this.left = monaco.editor.create(this.root.querySelector('.sbs-left'), {
            ...common,
            overviewRulerLanes: 0,
            scrollbar: {...scrollbar, vertical: 'hidden', verticalScrollbarSize: 0},
        })
        this.right = monaco.editor.create(this.root.querySelector('.sbs-right'), {
            ...common,
            lineDecorationsWidth: 4, // the IDE starts the right side's text just after the divider
            overviewRulerLanes: 1,
            scrollbar: {...scrollbar, vertical: 'auto', verticalScrollbarSize: 12},
        })
        this.disposables = []
        for (const side of ['L', 'R']) {
            const ed = this._ed(side)
            fullWidthSelection(monaco, ed)
            this.disposables.push(
                ed.onDidFocusEditorWidget(() => { this.lastFocused = ed; this._requestDraw() }),
                ed.onDidScrollChange((e) => this._scrolled(side, e)),
                ed.onDidLayoutChange(() => this.draw()),
                // the caret row's line number is brighter, as in the IDE
                ed.onDidChangeCursorPosition(() => this._requestDraw()),
            )
        }
        this.decoL = this.left.createDecorationsCollection()
        this.decoR = this.right.createDecorationsCollection()
        this.resizeObs = new ResizeObserver(() => this.draw())
        this.resizeObs.observe(this.canvas)
    }

    _ed(side) { return side === 'L' ? this.left : this.right }

    /** `labels` are HTML for the two headers. */
    setModels(original, modified, lineChanges, labels = {}) {
        this.changes = normalizeChanges(lineChanges)
        this.cur = -1
        this.userScrolled = true
        this.left.setModel(original)
        this.right.setModel(modified)
        this.emptyL = original.getValueLength() === 0
        this.emptyR = modified.getValueLength() === 0
        // an added or deleted file shows as one editor with its own line numbers, as in the IDE
        const one = this.emptyL && !this.emptyR ? 'R' : this.emptyR && !this.emptyL ? 'L' : null
        this.root.classList.toggle('one-L', one === 'L')
        this.root.classList.toggle('one-R', one === 'R')
        for (const side of ['L', 'R']) this._ed(side).updateOptions({lineNumbers: one === side ? 'on' : 'off', lineNumbersMinChars: one === side ? 4 : 0})
        this.headLeft.innerHTML = one === 'R' ? labels.right || '' : labels.left || ''
        this.headRight.innerHTML = one ? '' : labels.right || ''
        this._layoutDivider()
        this._decorate()
        this.left.setScrollPosition({scrollTop: 0, scrollLeft: 0})
        this.right.setScrollPosition({scrollTop: 0, scrollLeft: 0})
        this.draw()
    }

    /** New line changes for the same models, after an edit: keeps the scroll position. */
    updateChanges(lineChanges) {
        this.changes = normalizeChanges(lineChanges)
        this.cur = Math.min(this.cur, this.changes.length - 1)
        this._layoutDivider()
        this._decorate()
        this.draw()
    }

    /** Makes the right side (the PR's head) editable. */
    setEditable(on) {
        this.right.updateOptions({readOnly: !on, domReadOnly: !on})
        this.root.classList.toggle('editable', !!on)
    }

    _layoutDivider() {
        const lines = Math.max(this.left.getModel()?.getLineCount() || 1, this.right.getModel()?.getLineCount() || 1)
        const digits = Math.max(2, String(lines).length)
        const charW = this.fontSize * 0.6
        this.numW = Math.ceil(digits * charW + 16)
        this.curveW = 34
        const w = this.numW * 2 + this.curveW
        this.canvas.style.width = w + 'px'
        this.root.style.setProperty('--jd-divw', w + 'px')
        // the right header starts at the right line numbers, as in the IDE
        this.root.querySelector('.sbs-head').style.gridTemplateColumns = `minmax(0,1fr) ${this.numW + this.curveW}px ${this.numW}px minmax(0,1fr)`
    }

    setOptions({syncScroll, highlight}) {
        if (syncScroll !== undefined) this.syncScroll = syncScroll
        if (highlight !== undefined && highlight !== this.highlight) {
            this.highlight = highlight
            if (this.left.getModel()) this._decorate()
        }
        this.draw()
    }

    _decorate() {
        if (this.highlight === 'none') {
            this.decoL.set([])
            this.decoR.set([])
            return
        }
        const m = this.monaco
        const L = [], R = []
        const lane = m.editor.OverviewRulerLane.Full
        const ruler = {mod: DIFF_COLORS.modifiedRuler, ins: DIFF_COLORS.insertedRuler, del: DIFF_COLORS.deletedRuler}
        const mark = (t) => ({color: ruler[t], position: lane})
        const lc = this.left.getModel().getLineCount(), rc = this.right.getModel().getLineCount()
        // marginClassName too: the band covers the gutter, so it runs on unbroken from the divider into the code
        const band = (arr, from, to, t) => arr.push({range: new m.Range(from + 1, 1, to, 1), options: {isWholeLine: true, className: `dl-${t}`, marginClassName: `dl-${t}`, overviewRuler: mark(t)}})
        // a point (empty side) is a 2px line on the boundary below line `at`: 1px at the bottom of the line above and
        // 1px at the top of the line below (only the latter above line 1)
        const point = (arr, at, count, type) => {
            const add = (line, cls) => arr.push({range: new m.Range(line, 1, line, 1), options: {isWholeLine: true, className: cls, marginClassName: cls}})
            if (at >= 1) add(Math.min(at, count), `dl-pt-bot dl-pt-${type}`)
            if (at + 1 <= count) add(at + 1, `dl-pt-top dl-pt-${type}`)
        }
        const isEmpty = (l0, c0, l1, c1) => l1 === 0 || (l0 === l1 && c0 === c1)
        for (const c of this.changes) {
            const t = c.type
            if (c.l1 > c.l0) band(L, c.l0, c.l1, t)
            else if (!this.emptyL) point(L, c.l0, lc, t)
            if (c.r1 > c.r0) band(R, c.r0, c.r1, t)
            else {
                if (!this.emptyR) point(R, c.r0, rc, t)
                const line = Math.max(1, Math.min(c.r0, rc))
                R.push({range: new m.Range(line, 1, line, 1), options: {overviewRuler: mark(t)}})
            }
            if (t !== 'mod' || this.highlight !== 'words') continue
            for (const ch of c.chars) {
                const o = [ch.originalStartLineNumber, ch.originalStartColumn, ch.originalEndLineNumber, ch.originalEndColumn]
                const r = [ch.modifiedStartLineNumber, ch.modifiedStartColumn, ch.modifiedEndLineNumber, ch.modifiedEndColumn]
                const oEmpty = isEmpty(...o), rEmpty = isEmpty(...r)
                const inlineClassName = `dw-${oEmpty ? 'ins' : rEmpty ? 'del' : 'mod'}`
                if (!oEmpty) L.push({range: new m.Range(...o), options: {inlineClassName}})
                if (!rEmpty) R.push({range: new m.Range(...r), options: {inlineClassName}})
            }
        }
        this.decoL.set(L)
        this.decoR.set(R)
    }

    _scrolled(side, e) {
        const ed = this._ed(side)
        const exp = this.expect[side]
        if (exp && Math.abs(ed.getScrollTop() - exp.top) < 1 && Math.abs(ed.getScrollLeft() - exp.left) < 1) {
            this.expect[side] = null
        } else if (e.scrollTopChanged || e.scrollLeftChanged) {
            if (!this.navigating) this.userScrolled = true
            if (this.syncScroll) this._sync(side, side === 'L' ? 'R' : 'L')
        }
        this._requestDraw()
        this.onScroll?.()
    }

    _sync(fromSide, toSide) {
        const a = this._ed(fromSide), b = this._ed(toSide)
        const h = a.getLayoutInfo().height
        const lh = this.lineHeight
        const center = (a.getScrollTop() + h / 2) / lh
        const mapped = mapPosition(this.changes, center, fromSide === 'L')
        const maxTop = Math.max(0, b.getScrollHeight() - b.getLayoutInfo().height)
        const top = Math.round(Math.min(maxTop, Math.max(0, mapped * lh - h / 2)))
        const left = a.getScrollLeft()
        if (Math.abs(b.getScrollTop() - top) < 1 && Math.abs(b.getScrollLeft() - left) < 1) return
        this.expect[toSide] = {top, left: Math.min(left, Math.max(0, b.getScrollWidth() - b.getLayoutInfo().contentWidth))}
        b.setScrollPosition({scrollTop: top, scrollLeft: left})
    }

    _requestDraw() {
        if (this._raf) return
        this._raf = requestAnimationFrame(() => {
            this._raf = 0
            this.draw()
        })
    }

    draw() {
        const cv = this.canvas
        const dpr = window.devicePixelRatio || 1
        const W = cv.clientWidth, H = cv.clientHeight
        if (!W || !H || !this.left.getModel()) return
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
            cv.width = Math.round(W * dpr)
            cv.height = Math.round(H * dpr)
        }
        const ctx = this.ctx
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        // separators to the editors, under the bands so a band crosses them unbroken
        ctx.fillStyle = EDITOR_COLORS.separator
        ctx.fillRect(0, 0, 1, H)
        ctx.fillRect(W - 1, 0, 1, H)
        const lh = this.lineHeight
        const sL = this.left.getScrollTop(), sR = this.right.getScrollTop()
        const nW = this.numW, x0 = nW, x1 = W - nW
        const yL = (line) => line * lh - sL
        const yR = (line) => line * lh - sR

        for (const c of this.highlight === 'none' ? [] : this.changes) {
            let a0 = yL(c.l0), a1 = yL(c.l1), b0 = yR(c.r0), b1 = yR(c.r1)
            // an empty side is the 2px line on the boundary: the curve starts at that thickness, not from a point
            if (a1 === a0) { a0 = Math.round(a0) - 1; a1 = a0 + 2 }
            if (b1 === b0) { b0 = Math.round(b0) - 1; b1 = b0 + 2 }
            if (Math.max(a1, b1) < -2 || Math.min(a0, b0) > H + 2) continue
            ctx.fillStyle = c.type === 'mod' ? DIFF_COLORS.modified : c.type === 'ins' ? DIFF_COLORS.inserted : DIFF_COLORS.deleted
            ctx.fillRect(0, a0, x0, a1 - a0)
            ctx.fillRect(x1, b0, W - x1, b1 - b0)
            const k = this.curveW * 0.55
            ctx.beginPath()
            ctx.moveTo(x0, a0)
            ctx.bezierCurveTo(x0 + k, a0, x1 - k, b0, x1, b0)
            ctx.lineTo(x1, b1)
            ctx.bezierCurveTo(x1 - k, b1, x0 + k, a1, x0, a1)
            ctx.closePath()
            ctx.fill()
        }

        ctx.font = `${this.fontSize - 1}px ${this.fontFamily}`
        ctx.textBaseline = 'middle'
        const drawNums = (ed, empty, s, x, align) => {
            if (empty) return
            const caret = ed.hasWidgetFocus() || ed === this.lastFocused ? ed.getPosition()?.lineNumber - 1 : -1
            const count = ed.getModel().getLineCount()
            const first = Math.max(0, Math.floor(s / lh))
            const last = Math.min(count, Math.ceil((s + H) / lh))
            ctx.textAlign = align
            for (let i = first; i < last; i++) {
                ctx.fillStyle = i === caret ? EDITOR_COLORS.lineNumberCaret : EDITOR_COLORS.lineNumber
                ctx.fillText(String(i + 1), x, i * lh - s + lh / 2 + 0.5)
            }
        }
        drawNums(this.left, this.emptyL, sL, x0 - 8, 'right')
        drawNums(this.right, this.emptyR, sR, W - 8, 'right')
    }

    get count() { return this.changes.length }

    /** The index of the first change past the reading line (a third down the right editor) in direction `dir`. */
    _refIndex(dir) {
        const h = this.right.getLayoutInfo().height
        const ref = (this.right.getScrollTop() + h / 3) / this.lineHeight
        if (dir > 0) return this.changes.findIndex((c) => c.r0 > ref + 0.05)
        for (let i = this.changes.length - 1; i >= 0; i--) if (this.changes[i].r0 < ref - 0.05) return i
        return -1
    }

    /** The change a step in direction `dir` (1 or -1) goes to, or -1 at the ends. */
    _stepIndex(dir) {
        const i = this.userScrolled ? this._refIndex(dir) : this.cur + dir
        return i >= 0 && i < this.changes.length ? i : -1
    }

    /** Moves to the next (dir 1) or previous (dir -1) change; returns false at the ends. */
    step(dir) {
        const i = this._stepIndex(dir)
        if (i < 0) return false
        this.goTo(i)
        return true
    }

    canStep(dir) { return this._stepIndex(dir) >= 0 }

    goTo(i) {
        const c = this.changes[i]
        if (!c) return
        this.cur = i
        this.navigating = true
        const useRight = c.r1 > c.r0 || c.l1 === c.l0
        const ed = useRight ? this.right : this.left
        const line = useRight ? c.r0 : c.l0
        const h = ed.getLayoutInfo().height
        ed.setScrollTop(Math.max(0, line * this.lineHeight - h / 3))
        if (this.syncScroll) this._sync(useRight ? 'R' : 'L', useRight ? 'L' : 'R')
        else {
            const other = useRight ? this.left : this.right
            other.setScrollTop(Math.max(0, (useRight ? c.l0 : c.r0) * this.lineHeight - h / 3))
        }
        this.navigating = false
        this.userScrolled = false
        this.draw()
        this.onScroll?.()
    }

    /** The index of the change last navigated to, or -1 once the user scrolled. */
    currentIndex() {
        return this.userScrolled ? -1 : this.cur
    }

    setFont(fontSize, lineHeight) {
        // the relayout scrolls; a difference that was current stays current
        const keep = !this.userScrolled && this.cur >= 0 ? this.cur : -1
        if (keep >= 0) requestAnimationFrame(() => this.goTo(keep))
        this.fontSize = fontSize
        this.lineHeight = lineHeight
        this.root.style.setProperty('--jd-lh', lineHeight + 'px')
        this.left.updateOptions({fontSize, lineHeight})
        this.right.updateOptions({fontSize, lineHeight})
        this._layoutDivider()
        this.draw()
    }

    dispose() {
        cancelAnimationFrame(this._raf)
        this.resizeObs.disconnect()
        this.disposables.forEach((d) => d.dispose())
        this.left.dispose()
        this.right.dispose()
        this.root.remove()
    }
}
