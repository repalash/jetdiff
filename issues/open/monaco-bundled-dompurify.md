# Monaco 0.57 bundles DOMPurify 3.4.15

`npm audit` reports 2 low severity findings: monaco-editor 0.57.0 depends on dompurify 3.4.15, below the fixes of
advisories up to 3.4.16 (GHSA-6688-9rhm-gjv2, GHSA-c6gr-qvv4-5v3f, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr). The copy
that runs is not the npm package in `node_modules/monaco-editor/node_modules/` (the site does not serve it) but the one
built into Monaco's editor chunk (`min/vs/editor-*.js`, `version="3.4.15"`), so an npm `overrides` entry would quiet
the audit without changing the code that runs. Monaco uses it for Markdown in hovers and widgets, which jetdiff turns
off (`hover: {enabled: false}`); the advisories concern `IN_PLACE`, `SAFE_FOR_TEMPLATES` and the XHTML parser mode.

monaco-editor 0.58.0 (published 2026-11-23) is past the 7-day rule from 2026-11-30: check that it bundles 3.4.17 or
later, then upgrade (Dependabot proposes it on its own, as a separate pull request).
