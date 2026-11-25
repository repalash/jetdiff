# Atomic force updates

Amend and Undo move the branch with a forced ref update (`PATCH git/refs/heads/…` with `force: true`). The REST API
cannot make that update conditional, so `commitFiles` and `moveBranch` read the ref, compare it with the head the
edits were made on, and then update it. A push that lands between the read and the update is overwritten. The read is
now made just before the update (and never from a cache), so the window is one round trip, but it is still there.

A plain commit is safe: its update is not forced, and GitHub refuses one that is not a fast-forward.

Possible fix: GraphQL's `updateRefs` mutation takes `beforeOid` for each ref update and applies it only when the ref
is still there (`{refUpdates: [{name: "refs/heads/<branch>", afterOid, beforeOid, force: true}], repositoryId}`). It
needs the repository's node id, and a token that can use GraphQL with Contents: write (a fine-grained token can). A
refusal should keep the message the lease check gives now ("The branch has new commits…").
