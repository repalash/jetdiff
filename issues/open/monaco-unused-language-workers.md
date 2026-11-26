# The build copies Monaco's language workers, which never run

Since Monaco 0.53 the AMD build ships each language service worker twice (`min/vs/assets/*.worker-*.js` and
`min/vs/language/*/`): the TypeScript one is 7 MiB in each place. jetdiff never starts them (editor.js gives each
language an id of its own, so Monaco's TypeScript, JSON, CSS and HTML services stay out), and the service worker does
not keep them, but the build copies all of `min/vs` (`PREFIXES['monaco-editor/']` in `tools/site.mjs`): `dist/` grew
from 24 to 35 MiB with Monaco 0.57. The `files` filter could leave out `min/vs/language/` and the language workers in
`min/vs/assets/` (a test that no request reaches them would keep it true).
