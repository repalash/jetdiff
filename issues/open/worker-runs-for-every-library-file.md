# The Worker runs for every library file

`run_worker_first: true` (wrangler.jsonc) makes every request a Worker invocation, the ~200 library files a new visitor's
service worker fetches at install included (`vendor/`). Static asset requests that skip the Worker are free and
unmetered; Worker invocations count against the plan's request allowance. Options: keep it (every request logged and
given the headers); or `"run_worker_first": ["/*", "!/vendor/*"]`, with the `nosniff` header for `vendor/` from a
`_headers` file in `dist/` (they need no Content Security Policy, which only pages get).
