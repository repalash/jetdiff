// The security headers of the site's responses: the Worker sends them (index.js), and dist/_headers gives the same to
// the files the static asset server answers without it (the libraries).

// index.html's import map, the app's one inline script (npm run vendor writes this when the libraries change)
export const IMPORT_MAP_HASH = 'sha256-sr1wG3TDvNEMcbEfW3oiKKYq9///5w5gTYijhCYFQcA='

// Only what the app needs. Everything it runs comes from the site (the libraries too, in vendor/). Monaco sets inline
// styles. Images: the site, the diff's own blob: and data: images, and any https image, as Markdown previews show remote
// images. Connections go to the site, GitHub's API and avatars, and to the https sites snapshots and packs are opened
// from (?snap=https://…, ?packs=…): any https host, which gives away nothing img-src does not already allow. Workers:
// Monaco's from the site, and fflate's, which it starts from blob: URLs to unzip packs. Scripts: the site's, and
// Cloudflare Web Analytics' beacon, which Cloudflare adds to jetdiff.com's pages (its reports go to an https host).
export const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    `script-src 'self' '${IMPORT_MAP_HASH}' https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
].join('; ')

/**
 * dist/_headers, for the files the static asset server answers without the Worker (wrangler.jsonc run_worker_first):
 * the libraries in vendor/, with the Content Security Policy too, for the 404 page a missing one answers with.
 */
export function headersFile() {
    return '/vendor/*\n' + Object.entries(securityHeaders('', true)).map(([k, v]) => `  ${k}: ${v}\n`).join('')
}

/** The headers for a response of this content type; `document`: it answers a navigation. */
export function securityHeaders(contentType, document = false) {
    const headers = {'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin'}
    // also on a navigation's 304, which keeps the headers of the copy it revalidates otherwise
    if (document || /^text\/html\b/i.test(contentType || '')) headers['content-security-policy'] = CONTENT_SECURITY_POLICY
    return headers
}
