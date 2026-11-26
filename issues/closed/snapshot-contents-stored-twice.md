# File contents of a snapshot are cached twice

In snapshot and pack mode, file contents read from the snapshot also go into `jd-contents-v1`, so they take the space twice.

Done: in snapshot mode the contents are read from the snapshot only (kept in `jd-snap`), and an imported pack's answer
is never kept in `jd-contents-v1`, so another site's data never stays as GitHub's after Exit.
