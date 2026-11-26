# Edits of files that are not UTF-8 or have mixed line endings

Waiting for a decision (found in an audit of the git operations).

- A file that is not valid UTF-8 is decoded with U+FFFD for the bytes it cannot read; editing and committing it
  writes those replacement characters, so every such byte of the file changes.
- Monaco evens out mixed line endings (CRLF and LF in one file) to one kind. Edits are now compared with the model's
  own text, so typing an edit back leaves no edit, but committing a real edit of such a file also rewrites the line
  endings of every other line.

Smallest option: decode with `{fatal: true}`; a file that fails, or has mixed line endings, opens read-only, with the
reason next to the head's label (for example a tag "read-only: not UTF-8").
Alternatives: keep them editable and warn in the Commit panel before committing; or write back the original bytes of
the lines not edited (a line-level merge with the raw text), which keeps them editable.

Done (the smallest option): `getFileContent` decodes with `{fatal: true}` and marks a file that fails, or has both CRLF
and LF lines, `readOnly`; it opens read-only with "read-only: not UTF-8" or "read-only: mixed line endings" on the
head's label, and Commit refuses an edit of such a file stored before.
