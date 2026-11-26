// A new release of the app is ready when the service worker has fetched all of its files and taken over (sw.js). The
// page keeps the release it was loaded with until it reloads.
const UPDATED = 'jd-app-updated'
const CHECK_EVERY = 60 * 60e3
let updated = false

try {
    const sw = navigator.serviceWorker
    let controlled = !!sw.controller
    sw.addEventListener('controllerchange', () => {
        // the first worker to take over a page brings the release the page already has
        if (controlled && !updated) {
            updated = true
            window.dispatchEvent(new Event(UPDATED))
        }
        controlled = true
    })
    // the browser looks for a new release when a page loads; a page left open looks too
    let checked = Date.now()
    const check = () => {
        checked = Date.now()
        sw.getRegistration().then((r) => r?.update()).catch(() => { /* offline */ })
    }
    setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checked > CHECK_EVERY / 6) check() })
} catch { /* a sandboxed page has no service worker */ }

/** Calls `fn` once, when a new release of the app is ready (at once if one is): the page offers to reload. */
export function onAppUpdate(fn) {
    if (updated) fn()
    else window.addEventListener(UPDATED, () => fn(), {once: true})
}
