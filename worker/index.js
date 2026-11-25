// Serves the static assets (dist/). Running first on every request gives request logs (Workers Logs) and adds what
// the asset server does not: the www redirect and a few security headers.
const HEADERS = {'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin'}

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.hostname.startsWith('www.')) {
            url.hostname = url.hostname.slice(4)
            return Response.redirect(url.href, 301)
        }
        const asset = await env.ASSETS.fetch(request)
        const res = new Response(asset.body, asset)
        for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v)
        return res
    },
}
