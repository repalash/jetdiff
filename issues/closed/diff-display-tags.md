# Diff labels (Q20)

Asked in the decisions round, decided by the maintainer:
- a "whitespace only" tag where a file's only changes are whitespace;
- saying when a Markdown file has changes the preview cannot show (in links, HTML, front matter);
- line-ending and BOM-only changes named as such;
- an "edited here" tag on files with unpushed edits;
- a local Viewed mark cleared when the file changes on GitHub after it.

Done:
- The head's label of a diff (side by side, unified, aligned, and the Markdown preview) has tags for what the diff
  cannot show (`headTagsHtml`, `hiddenChange` in main.js), from the texts as read (with their BOM and line endings):
  "whitespace only" when every changed line differs in whitespace only (the lines without whitespace are the same, as
  the "Ignore whitespaces" setting compares them); "line endings changed: CRLF → LF" (LF, CRLF, CR or mixed) and
  "byte-order mark added/removed", which Monaco's models even out or keep aside, so the diff shows no difference.
- "edited here" on the head's label of a file with an edit not committed; it follows the edit as it is typed (the tags
  are rendered again by `renderEdits`), and the tags are computed from the edited text then. The tree already marked
  edited files with an accent dot (`.ted`).
- The Markdown preview says "N of M changes not shown: see Code" (or "changes not shown") when changes do not show in
  it, and switches to Code on a click (`hiddenChanges` in markdown.js): a change is not shown when the top-level blocks
  around it (with the unchanged line before and after) render the same on both sides once their attributes are left
  out: link targets, image sources, HTML attributes, reference definitions, comments, and syntax that renders the same.
  Front matter is not hidden: markdown-it renders it as a rule and a heading, so its changes show.
- Local Viewed marks are stored as `{path: version}`, the version being the file's blob sha at the head shown (the
  head itself for a two-dot compare, which lists no blobs): a file that changes after it was marked shows as not viewed.
  A queued mark (`.pending`) holds the version too, and is dropped instead of sent when the file changed since (GitHub
  has reset its state then). Marks stored before, as a list of paths, read as no marks.
