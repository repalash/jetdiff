# Bare domains are no longer links in Markdown (markdown-it 15)

markdown-it 15 uses linkify-it 6, which turns off fuzzy links by default: `files.threepipe.org`, `www.example.com` and
`README.md` in a Markdown file or a comment stay text, where markdown-it 14 linked all three (`README.md` to
`http://README.md`). URLs with a scheme and e-mail addresses are still links. GitHub links `www.` hosts but not bare
domains or file names. Also changed: Unicode punctuation ends a link (`https://example.com/path（括弧）` stops before
`（`), IPv6 hosts are links, and the auth part is no longer read by default (`https://user:pass@example.com/` links only
`https://user`; `urlAuth` turns it back on).

A decision: keep the new default (as the upgrade does), turn fuzzy links back on (`md.linkify.set({fuzzyLink: true})`,
the old behaviour, `README.md` included), or link only what GitHub links (`www.` hosts: a linkify-it rule of our own).
