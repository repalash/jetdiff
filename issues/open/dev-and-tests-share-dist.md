# npm start and npm test build into the same dist/

Both run `wrangler dev`, which runs `node tools/build.mjs` on start (wrangler.jsonc `build`), and the build removes and
writes `dist/` again. Run at the same time in one checkout, the tests' build replaces the files `npm start` serves (and
the two builds can collide: `ENOTEMPTY` from `rmSync`). The Playwright server on another port does not share the dev
server, as `reuseExistingServer` only looks at `TEST_PORT`. Options: the build writes to a directory given by the
environment (e.g. `.wrangler/test-dist`) and the tests pass it to wrangler with `--assets`; or the tests reuse a running
`npm start`.
