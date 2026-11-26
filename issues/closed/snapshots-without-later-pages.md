# Snapshots recorded before paging miss pages 2 and on

A commit's files are now read 100 a page past the first page, and a compare's commits up to three pages. A snapshot or
pack recorded before has only the first page, so a commit with exactly 100, 200… files, or a compare of over 100
commits, fails to open from it ("Not in this snapshot") instead of showing the first page. Recording again fixes it.

Closed: jetdiff has no users yet, so no support for snapshots recorded before the change; record them again.
