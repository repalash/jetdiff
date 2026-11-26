# The date of recorded data is rarely known

The bar over recorded data shows the recording's date only when a snapshot's server sends `Last-Modified` for its
index.json (the dev server sends none). Packs carry no date: the recorder (tools/record-snapshot.cjs) could write one
into repos.json, and `importPack` could keep it with the pack's entry in `jd.offline`.
