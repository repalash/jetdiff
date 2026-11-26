// Next and Previous Difference in Monaco editors, as in the IDE's diff: where a step goes on from, the caret at the
// change's first line, and the change in the middle of the view. The side-by-side viewer (sbs.js) and the unified and
// aligned views (main.js) share them.

/**
 * Monaco line changes (1-based, `*EndLineNumber` 0 for an empty side) as 0-based half-open ranges
 * `{l0, l1, r0, r1, type, chars}`. An empty side is a point: l0 === l1 is the boundary after line l0.
 */
export function normalizeChanges(lineChanges) {
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

/** A change's 0-based lines on a side ('L' or 'R'): [first, end), empty for a point. */
const linesOn = (c, side) => (side === 'L' ? [c.l0, c.l1] : [c.r0, c.r1])

/**
 * The change a step in direction `dir` goes to from 0-based line `at` of a side, or -1: the first starting below it, or
 * the last ending above it. A change at `at` (a point's line is the one below it, where its caret goes) is the current
 * one, passed both ways.
 */
export function changeFrom(changes, side, at, dir) {
    if (dir > 0) return changes.findIndex((c) => linesOn(c, side)[0] > at)
    for (let i = changes.length - 1; i >= 0; i--) {
        const [a, b] = linesOn(changes[i], side)
        if (Math.max(b, a + 1) <= at) return i
    }
    return -1
}

/** The 1-based line a step puts the caret on: the change's first line, or the line below a point. */
export function caretLine(ed, c, side) {
    return Math.max(1, Math.min(linesOn(c, side)[0] + 1, ed.getModel().getLineCount()))
}

/**
 * The change's extent in `ed`, in pixels from the top of its content, with the view zones in it (deleted lines in the
 * unified view, padding in the aligned one).
 */
function extent(ed, c, side) {
    const [a, b] = linesOn(c, side)
    if (b > a) return [ed.getTopForLineNumber(a + 1, true), ed.getBottomForLineNumber(b, true)]
    // a point: the zones after line `a`, with the caret's line below them
    const count = ed.getModel().getLineCount()
    const top = a ? ed.getBottomForLineNumber(Math.min(a, count)) : 0
    return [top, a < count ? ed.getBottomForLineNumber(a + 1) : ed.getBottomForLineNumber(count, true)]
}

/** The scroll top that shows the change in the middle of `ed`'s view; one taller than the view starts near its top. */
export function centredTop(ed, c, side, lineHeight) {
    const [top, bottom] = extent(ed, c, side)
    const h = ed.getLayoutInfo().height
    const gap = 3 * lineHeight
    return Math.max(0, bottom - top > h - 2 * gap ? top - gap : (top + bottom - h) / 2)
}

/**
 * Where the next step goes on from, in a set of editors: `from` is 'step' after a step (the change it went to), 'caret'
 * once the user moved the caret (`editor` has it), 'scroll' once the user scrolled (the middle of the view).
 */
export class StepOrigin {
    constructor(monaco, editors, onChange = () => {}) {
        this.from = 'scroll'
        this.editor = null
        this.stepping = false
        let moving = false
        const flush = monaco.editor.CursorChangeReason.ContentFlush
        this.disposables = editors.flatMap((ed) => [
            ed.onDidChangeCursorPosition((e) => {
                if (this.stepping || e.reason === flush) return
                this.from = 'caret'
                this.editor = ed
                // the scroll that reveals the caret belongs to the move
                moving = true
                queueMicrotask(() => { moving = false })
                onChange()
            }),
            ed.onDidScrollChange((e) => {
                if (this.stepping || moving || !e.scrollTopChanged || this.from === 'scroll') return
                this.from = 'scroll'
                onChange()
            }),
        ])
    }

    /** Runs a step: the caret and the scroll it sets are not the user's. */
    step(fn) {
        this.stepping = true
        try { fn() } finally { this.stepping = false }
        this.from = 'step'
    }

    dispose() { this.disposables.forEach((d) => d.dispose()) }
}

/** Where a tip about the caret goes: under the caret's line, at the caret, in the page (clamped into the editor's view). */
export function caretPoint(ed) {
    const p = ed.getPosition(), v = p && ed.getScrolledVisiblePosition(p)
    const r = ed.getDomNode().getBoundingClientRect()
    if (!v) return {x: r.left + r.width / 2, y: r.top}
    // a view just shown has not measured its line yet: the start of the text, where a step's caret is
    const left = Number.isFinite(v.left) ? v.left : ed.getLayoutInfo().contentLeft
    return {x: r.left + Math.max(0, Math.min(left, r.width)), y: r.top + Math.max(0, Math.min(v.top + v.height, r.height - v.height))}
}
