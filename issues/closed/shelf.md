# A Shelf tab, as in the IDE

Decided (Q35), not built: edits kept aside (a clash with a newer push, an older edit replaced) show in a Shelf tab
instead of the kept-aside dialog: entries with their files, the shelved version against the current one in the
viewer, Unshelve only when the file is unchanged since (else the three-way merge, three-way-merge.md), Delete, Copy,
Download, and Shelve Changes from the Commit panel.

Done (`tests/shelf.spec.js`):
- Storage: the PR's entry in `jd.edits` has `shelf: [{id, name?, reason?, date, files: [{path, head, text}]}]`, newest
  first, in place of `conflicts`: `name` for an entry shelved by the user, `reason` ('changed' or 'replaced') for one a
  load made, `date` in ms, and each file's text with the head it was edited on.
- The Commit tool window has two tabs, Commit and Shelf (with its count), in the side panel's head, on a phone in the
  drawer too; the strip's Commit button opens the tab shown last. The Commit tab's kept-aside link is now "N files on
  the Shelf", and the toasts say "shelved", with Show.
- The Shelf lists the entries (name or reason, date) with their files; a click on a file shows the shelved text
  against the current version (the head's, with its edit if any) in the viewer, read-only, labelled "shelved" and
  "Current version" (`showShelved`).
- Its toolbar acts on the selection, a file or an entry: Unshelve (off, with the reason as its tip and a tap's toast,
  while the file changed on GitHub since the head it was edited on, has an edit now, or a commit of the pull request
  shows), Copy (one file), Download (one file as it is, several as a .zip made with fflate) and Delete (with Undo).
- Shelve Changes (in the Commit tab's toolbar, and Search Everywhere) moves the checked edits to a new entry, named
  after the commit message's first line, else "Changes of" the date, as in the IDE.
