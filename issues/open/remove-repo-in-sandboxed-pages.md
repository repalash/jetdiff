# Removing a downloaded repository keeps its pack data

`removeRepo` (js/offline.js) removes the repository's saved API responses and file contents (and works where the page
has no Cache Storage), but leaves its files in `jd-pack`, `jd-snap` and the in-memory packs, so an imported pack of it
still opens.
