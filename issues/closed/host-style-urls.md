# Host-style URLs

`jetdiff.com/owner/repo/pull/123` (and `/commit/<sha>`, `/compare/a...b`) opens the same as `?pr=owner/repo/123`,
so replacing the host of a GitHub link opens it here. Needs the static host to answer every path with index.html,
and the page to read its target from the path.

Done: `404.html` maps the path to the app's URL (`/?pr=…`), the dev server and the Worker answer missing paths with
it, and the service worker serves it offline.
