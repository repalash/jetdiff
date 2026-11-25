// Sign in with GitHub through a GitHub App. The code-for-token exchange needs the app's secret and GitHub's token
// endpoint refuses browser requests, so it happens here. The access token goes to the page in the URL fragment (never
// sent to a server); the refresh token stays in an HttpOnly cookie that only /auth/refresh reads.
const GITHUB = 'https://github.com/login/oauth'
const STATE = 'jd_auth_state'
const REFRESH = 'jd_refresh'

const cookie = (name, value, maxAge) =>
    `${name}=${encodeURIComponent(value)}; Path=/auth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`

function cookies(request) {
    const out = {}
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const i = part.indexOf('=')
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
    return out
}

// only a path on this site, never another host (//evil.example)
const safeReturn = (path) => path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/'

async function exchange(env, params) {
    const res = await fetch(`${GITHUB}/access_token`, {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify({client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params}),
    })
    return res.ok ? res.json() : {error: `GitHub answered ${res.status}`}
}

function withTokens(headers, tokens) {
    if (tokens.refresh_token) headers.append('set-cookie', cookie(REFRESH, tokens.refresh_token, tokens.refresh_token_expires_in || 15552000))
    return headers
}

const fail = (message, status = 400) => new Response(message, {status, headers: {'content-type': 'text/plain; charset=utf-8'}})

export async function auth(request, env, url) {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail('Sign-in is not set up here', 404)
    const route = url.pathname.slice('/auth/'.length)
    const post = request.method === 'POST'

    if (route === 'config') return Response.json({clientId: env.GITHUB_CLIENT_ID, appSlug: env.GITHUB_APP_SLUG || ''})

    if (route === 'login') {
        const state = crypto.randomUUID()
        const to = new URL(`${GITHUB}/authorize`)
        to.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
        to.searchParams.set('redirect_uri', `${url.origin}/auth/callback`)
        to.searchParams.set('state', state)
        const headers = new Headers({location: to.href})
        headers.append('set-cookie', cookie(STATE, `${state}|${safeReturn(url.searchParams.get('return'))}`, 600))
        return new Response(null, {status: 302, headers})
    }

    if (route === 'callback') {
        const [state, back] = (cookies(request)[STATE] || '').split('|')
        if (!state || state !== url.searchParams.get('state')) return fail('Sign-in expired or was started elsewhere: try again')
        const tokens = await exchange(env, {code: url.searchParams.get('code'), redirect_uri: `${url.origin}/auth/callback`})
        if (!tokens.access_token) return fail(`GitHub did not sign you in: ${tokens.error_description || tokens.error || 'no token'}`)
        const fragment = new URLSearchParams({'jd-auth': tokens.access_token, ...tokens.expires_in && {expires_in: tokens.expires_in}})
        const headers = withTokens(new Headers({location: `${safeReturn(back)}#${fragment}`}), tokens)
        headers.append('set-cookie', cookie(STATE, '', 0))
        return new Response(null, {status: 302, headers})
    }

    if (route === 'refresh' && post) {
        const refresh = cookies(request)[REFRESH]
        if (!refresh) return fail('Not signed in', 401)
        const tokens = await exchange(env, {grant_type: 'refresh_token', refresh_token: refresh})
        if (!tokens.access_token) return fail('Sign in again', 401)
        return Response.json({access_token: tokens.access_token, expires_in: tokens.expires_in || 0},
            {headers: withTokens(new Headers({'cache-control': 'no-store'}), tokens)})
    }

    if (route === 'logout' && post) return new Response(null, {status: 204, headers: {'set-cookie': cookie(REFRESH, '', 0)}})

    return fail('Not found', 404)
}
