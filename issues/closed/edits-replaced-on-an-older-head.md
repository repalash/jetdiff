# Edits of an older head replaced by newer ones are still dropped

When a load carries edits over from an older head and the same file has a different edit at the new head already
(another tab, or an edit made after an Undo), the older edit is deleted with a toast ("Dropped your edits of …: edited
again since"). Its text is gone. It could go to the `conflicts` list, as an edit of a file that changed on GitHub does.

Done: it went to the `conflicts` list, and now goes to the Shelf as an automatic entry (`reason: 'replaced'`), with a
toast whose "Show" opens it (shelf.md).
