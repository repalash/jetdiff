# Edits are dropped when their file changed on GitHub

Waiting for a decision (found in an audit of the git operations).

When the pull request's head moves, an edit made on the older head is carried over only if its file is the same at
both heads. When the file did change, the edit is deleted from storage, and a toast says so ("Dropped your edits of
…: changed on GitHub since"). The text is gone. (A read that fails no longer drops it: the edit stays in `pending`
and is tried again on the next load.)

Smallest option: move such an edit to a `conflicts` list of the PR's entry in `jd.edits` ([{path, head, text}]) in
place of deleting it, and give the toast a "Show" action that opens a dialog listing them, each with Copy, Download
and Discard.
Alternatives: keep it as the edit of the new head and show the diff against the new head, so the user resolves it in
the editor (a commit would revert the upstream change unless they do); or offer a three-way merge with the upstream
change.

Done (the smallest option): such an edit moves to the PR entry's `conflicts` list in `jd.edits` ([{path, head, text}]);
the toast names the files with a "Show" action, and the dialog (also from "N edits kept aside" in the Commit panel)
offers Copy, Download and Discard for each (`conflictsDialog` in js/main.js).
