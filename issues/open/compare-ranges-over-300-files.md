# Commit ranges stop at 300 files

A commit range (`a..b`) in `loadChangeSet` and in `getCommitFiles` reads only the first page of the compare API, so a range with more than 300 changed files silently drops the rest. Reading more pages needs those pages in snapshots too (recorded snapshots have page 1 only).
