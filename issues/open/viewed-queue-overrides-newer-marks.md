# A queued Viewed mark can undo a newer one

A Viewed mark made offline waits in `viewed.<repo>/#<n>.pending` and is sent on the next load. Marks GitHub already
has are dropped from the queue, but a mark that GitHub has the other way is sent, even when the other way is newer
(the file was marked again from another device, or GitHub set it to DISMISSED because the file changed after it was
viewed). GitHub gives no time for a viewed state, so the queue cannot tell.

Possible fix: keep the time and the PR head of each queued mark, and skip it when the head has moved since (GitHub
resets the state of a changed file then) or when it is older than the PR's last update from another client.
