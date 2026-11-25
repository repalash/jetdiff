export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])

/** `plural(3, 'file')` is '3 files'. */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export const baseName = (path) => path.split('/').pop()

export const shortSha = (sha) => (sha || '').slice(0, 8)

export const firstLine = (text) => text.split('\n')[0]

/** Detects a double-click by hand: a click re-renders the rows, so the browser's dblclick never fires on them. */
export function doubleClicks(ms = 450) {
    let last = null
    return (key) => {
        const now = performance.now()
        const dbl = last?.key === key && now - last.t < ms
        last = dbl ? null : {key, t: now}
        return dbl
    }
}
