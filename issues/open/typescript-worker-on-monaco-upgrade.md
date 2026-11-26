# The TypeScript worker depends on Monaco's AMD build

js/typescript.js starts Monaco's TypeScript worker with `monaco.editor.createWebWorker({moduleId:
'vs/language/typescript/tsWorker'})`, which Monaco 0.52's AMD build loads inside its editor worker
(min/vs/language/typescript/tsWorker.js, 5.5 MB, kept by sw.js once used or by Download for offline). A Monaco version
without the AMD build loads workers differently: the TypeScript worker would need its own worker URL from the site
(`worker-src 'self'` still holds), and the `PREFIXES` entry of `tools/site.mjs` its files.

The branch `later/library-upgrades` (Monaco 0.57) keeps the AMD build, but Monaco starts its workers itself there
(a `blob:` URL that loads the site's worker file) and its files have hashed names: check Go to Declaration and the
hovers in TypeScript files, and what `amdModules()` precaches, when merging it.
