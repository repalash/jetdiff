// Serves the static assets (dist/). Running first on every request but the libraries' (vendor/, see wrangler.jsonc)
// gives request logs (Workers Logs, without the query) and adds what the asset server does not: the www redirect,
// sign-in (auth.js) and the security headers, with the Content Security Policy (headers.js).
import {auth} from './auth.js'
import {securityHeaders} from './headers.js'

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.hostname.startsWith('www.')) {
            url.hostname = url.hostname.slice(4)
            return Response.redirect(url.href, 301)
        }
        const start = Date.now()
        const res = url.pathname.startsWith('/auth/') ? await auth(request, env, url) : await asset(request, env)
        const headers = securityHeaders(res.headers.get('content-type'), request.headers.get('sec-fetch-dest') === 'document')
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
        log(request, url, res, start)
        return res
    },
}

async function asset(request, env) {
    const res = await env.ASSETS.fetch(request)
    return new Response(res.body, res)
}

// a GitHub-style path (/owner/repo/pull/1) names a repository, maybe a private one: logged as a link, not by name
function log(request, url, res, start) {
    const path = res.status === 404 && !url.pathname.startsWith('/auth/') ? '/(github link)' : url.pathname
    console.log(JSON.stringify({method: request.method, path, status: res.status, ms: Date.now() - start}))
}
