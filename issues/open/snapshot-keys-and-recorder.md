# Snapshot keys ignore the Accept header; the recorder fetches twice

Snapshots key responses by path and query only, so the same URL asked with two Accept headers is recorded once (harmless today: no URL is asked both ways). `tools/record-snapshot.cjs` also fetches a URL twice when the page asks it twice at the same time, and repeats `offline.js`'s list of base and head contents of a change set inside its `page.evaluate`.
