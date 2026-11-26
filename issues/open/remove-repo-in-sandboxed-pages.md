# Removing a downloaded repository keeps its snapshot files

`removeRepo` (js/offline.js) removes the repository's saved API responses and file contents, and what the imported
packs hold of it (`jd-pack` or the in-memory packs), but leaves the snapshot files in `jd-snap`, so a snapshot of it
still opens offline.
