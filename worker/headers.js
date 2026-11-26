// The security headers of the site's responses: the Worker sends them (index.js), and the dev server the tests run
// against (tools/serve.mjs) sends the same.

// index.html's import map, the app's one inline script (npm run vendor writes this when the libraries change)
export const IMPORT_MAP_HASH = 'sha256-7Ch4d8SjiGpNHVuhHDvg9m38KBGcvOLF19GHaPGaFqU='

// Only what the app needs. Everything it runs comes from the site (the libraries too, in vendor/). Monaco sets inline
// styles. Images: the site, the diff's own blob: and data: images, and any https image, as Markdown previews show remote
// images. Connections go to the site, GitHub's API and avatars, and to the https sites snapshots and packs are opened
// from (?snap=https://…, ?packs=…): any https host, which gives away nothing img-src does not already allow. Workers:
// Monaco's and fflate's, which they start from blob: URLs (Monaco's then load its worker from the site). Fonts: the
// site's, and Monaco's icon font, which its stylesheet carries as a data: URL.
export const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    `script-src 'self' '${IMPORT_MAP_HASH}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
].join('; ')

/** The headers for a response of this content type; `document`: it answers a navigation. */
export function securityHeaders(contentType, document = false) {
    const headers = {'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin'}
    // also on a navigation's 304, which keeps the headers of the copy it revalidates otherwise
    if (document || /^text\/html\b/i.test(contentType || '')) headers['content-security-policy'] = CONTENT_SECURITY_POLICY
    return headers
}
