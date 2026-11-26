# Port to Monaco 0.57 and markdown-it 15

Done on the branch `later/library-upgrades` (all tests pass there), not merged. Open before merging:

- Monaco puts its icon font in its stylesheet as a `data:` URL: allow `font-src data:`, or serve the font as a file.
- markdown-it 15 no longer links bare domains (`files.threepipe.org`): keep that, turn fuzzy links back on, or link
  `www.` hosts only, as GitHub does.
- Monaco 0.57 has DOMPurify 3.4.15 built in (two low advisories); 0.58 may carry a newer one.
- Monaco's unused language workers add about 11 MiB to `dist/`.
- On a phone (emulated), clicks in the editors log a Clipboard `NotAllowedError`: check on a real iPhone.
- Go to Declaration and hovers in TypeScript files (see typescript-worker-on-monaco-upgrade.md).
- Remove the `monaco-editor` ignore from `.github/dependabot.yml`.
