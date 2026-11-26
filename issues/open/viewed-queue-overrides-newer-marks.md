# A queued Viewed mark can undo a newer one

A Viewed mark made offline waits in `viewed.<repo>/#<n>.pending` and is sent on the next load. Marks GitHub already
has are dropped from the queue, and so is a mark of a file that changed since it was made (each queued mark holds the
file's blob: GitHub resets the state of a changed file). But a mark that GitHub has the other way is still sent when
the other way is newer and the file did not change (it was marked again from another device). GitHub gives no time
for a viewed state, so the queue cannot tell.

Possible fix: keep the time of each queued mark, and skip it when it is older than the PR's last update from another
client.

The blob check runs on a pull request's full changes only: on one of its commits, the files are at that commit, not at
the head GitHub's state is for.
