# File contents of a snapshot are cached twice

In snapshot and pack mode, file contents read from the snapshot also go into `jd-contents-v1`, so they take the space twice.
