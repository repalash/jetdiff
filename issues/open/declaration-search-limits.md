# Go to Declaration: what the symbol search does not find

- The patterns (js/declarations.js) are simple, per line: a declaration over several lines, a class field without a
  modifier, a Python attribute set in `__init__`, Go grouped specs with `=`, Rust struct fields without `pub` are not
  found; a statement that looks like a C declaration can be.
- In the changed files, at most 200 file versions are read per search with a token, 30 without (GitHub allows 60
  requests an hour then), the nearest first: a larger pull request can miss a declaration in the others.
- GitHub's code search sees the default branch only; the files it names are read at the pull request's commit, and
  dropped when they do not exist there. Results are not cached: each Go to Declaration that gets there costs one of the
  10 searches a minute.
- TypeScript: only relative imports are loaded; `paths` aliases from tsconfig.json and packages (node_modules) are not,
  so their names fall back to the symbol search. A `.mts`/`.cts` file is read as JavaScript by Monaco's worker
  (`getScriptKind` knows .ts/.tsx/.js/.jsx only).
