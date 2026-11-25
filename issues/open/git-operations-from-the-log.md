# Git operations from the Log

The Log's context menu offers the operations the API can do on the PR's branch: edit a commit message (the head
commit first, then any commit by rewriting the commits after it), revert a commit, drop the head commit, and
cherry-pick a commit onto the branch. Each one is checked against the branch's head (as Commit and Push is) and
offers Undo.
