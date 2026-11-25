# Removing a downloaded repository fails in sandboxed pages, and keeps its pack data

`removeRepo` (js/offline.js) opens Cache Storage without a try/catch, so it throws where there is none (a sandboxed page). It also leaves the repository's files in `jd-pack`, `jd-snap` and the in-memory packs.
