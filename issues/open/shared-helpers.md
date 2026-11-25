# Shared helpers left to fold

- `localStorage` access is wrapped in try/catch separately in main.js (`store`), github.js (token, snapshot) and offline.js: one helper in util.js.
- A commit's subject, author and date are formatted the same way in log.js and main.js.
- `listPullRequests` (github.js) works out a PR's merged state like `prState` in main.js.
- `languageName` (editor.js) capitalizes like `cap` in main.js; `languageForPath` finds the extension like `extension()` in icons.js.
- Which cache keys belong to a repository (`/repos/o/r/`, `repo:o/r`) is written in offline.js (`removeRepo`) and tools/make-pack.py.
- The cache names are literals in sw.js and constants in github.js.
- `FONT` in main.js repeats the CSS `--code-font` (Monaco needs the string).
