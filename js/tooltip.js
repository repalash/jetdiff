/**
 * Replaces the browser's tooltips, which wait a second or more: a `title` moves to `data-tip` on hover and shows
 * after `delay` ms. Mouse only: touch screens have no hover.
 */
export function installTooltips(delay = 300) {
    if (!matchMedia('(hover: hover)').matches) return
    const tip = document.createElement('div')
    tip.className = 'tip'
    tip.hidden = true
    tip.setAttribute('role', 'tooltip')
    document.body.appendChild(tip)
    let target = null, timer = 0
    const hide = () => { clearTimeout(timer); tip.hidden = true; target = null }
    const show = (el) => {
        if (!el.isConnected || !el.dataset.tip) return
        tip.textContent = el.dataset.tip
        tip.hidden = false
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight
        const x = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6))
        const y = r.bottom + 6 + h < innerHeight ? r.bottom + 6 : r.top - h - 6
        tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return
        const el = e.target.closest?.('[title], [data-tip]')
        if (el === target) return
        hide()
        if (!el || el.closest('.monaco-editor')) return
        if (el.hasAttribute('title')) {
            const t = el.getAttribute('title')
            el.removeAttribute('title')
            if (!t) return
            el.dataset.tip = t
            if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t)
        }
        target = el
        timer = setTimeout(() => show(el), tip.hidden ? delay : 0)
    })
    document.addEventListener('pointerout', (e) => { if (target && !target.contains(e.relatedTarget)) hide() })
    for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, hide, true)
    addEventListener('blur', hide)
}

/**
 * A tip in the same style under the point (x, y) of the page, its arrow pointing up at it, until the returned function
 * hides it: Next Difference's "Press again" at the caret's line. On touch screens too.
 */
export function pointTip(x, y, text) {
    const tip = document.createElement('div')
    tip.className = 'tip tip-point'
    tip.setAttribute('role', 'status')
    tip.textContent = text
    document.body.appendChild(tip)
    const w = tip.offsetWidth
    const left = Math.max(6, Math.min(x - 14, innerWidth - w - 6))
    tip.style.setProperty('--arrow', `${Math.round(Math.max(8, Math.min(x - left, w - 8)))}px`)
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(y + 7)}px)`
    return () => tip.remove()
}
