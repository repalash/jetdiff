# Local snapshots and packs do not open under npm start

`?snap=<name>` reads `snap/<name>/` next to the page, and `?packs=<folder>` a folder of packs (README, Snapshots and
offline packs). The Node dev server served the whole checkout, so `npm start` showed `snap/demo/` and `packs/` as
recorded. `wrangler dev` serves `dist/` only, which holds neither (they must never be deployed: a snapshot of a private
repository holds its code), so these links get the 404 page. Recording works (the recorder answers GitHub itself), and
the tests are not affected (they answer `snap/` and `packs/` with routes).

The asset server does not follow a symlinked folder in `dist/` (miniflare lists it with `readdir({recursive: true})`
and skips links), so linking `snap/` in is no way. Options:
- the build copies `snap/` and `packs/` into `dist/` when wrangler runs it for `dev` (wrangler sets
  `WRANGLER_COMMAND=dev` for the custom build; a deploy builds again without them), with both folders in
  `build.watch_dir` so that a new recording shows; costly for large snapshots, and one mistake from deploying them;
- open local data through `?snap=https://…` and `?packs=https://…` from a static server with https on localhost;
- a small script that serves `snap/` and `packs/` on another port, and the app accepts `http://localhost` for `?snap=`.
