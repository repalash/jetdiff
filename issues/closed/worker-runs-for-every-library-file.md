# The Worker runs for every library file

`run_worker_first: true` (wrangler.jsonc) makes every request a Worker invocation, the ~200 library files a new visitor's
service worker fetches at install included (`vendor/`). Static asset requests that skip the Worker are free and
unmetered; Worker invocations count against the plan's request allowance. Options: keep it (every request logged and
given the headers); or `"run_worker_first": ["/*", "!/vendor/*"]`, with the `nosniff` header for `vendor/` from a
`_headers` file in `dist/` (they need no Content Security Policy, which only pages get).

Done: `"run_worker_first": ["/*", "!/vendor/*"]`, and `npm run build` writes `dist/_headers` with the same headers for
`vendor/*` (`headersFile()` in worker/headers.js). A first try was reverted: the asset server answers a path that
`encodeURIComponent` changes with a 307 to the encoded one, and every library URL had an `@` (`vendor/name@version/`).
The libraries are now at `vendor/<name>/<version>/`, a scope as a folder (`vendor/fontsource/inter/5.3.0/`), and a
test checks that no path the site serves changes when encoded. The tests and `npm start` run on `wrangler dev` (the
Worker and the asset server, in workerd) instead of a Node server that only mimicked the Worker, and a browser test
counts no redirect on a first visit, with the service worker installing (which also found the 307s of `./index.html`
and `./404.html`: the release keeps them as `./` and `./404`).
