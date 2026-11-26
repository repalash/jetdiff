# A recording of one pull request cannot be made into a pack

Local recorded data opens by importing packs only, and `tools/make-pack.py` reads the repositories from `repos.json`,
which `record-snapshot.cjs` writes only with `--repos`. A recording of one pull request (`npm run record -- <page url>
owner/repo/123 demo`) therefore opens only from an https site (`?snap=https://…`), not locally. The recorder could
write `repos.json` for one pull request too (that repository, that pull request), or make-pack could take the
repository from the index's paths.
