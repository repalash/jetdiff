# "Changes not shown" in the Markdown preview works by block

`hiddenChanges` (js/markdown.js) compares the top-level blocks around each change, rendered without attributes. So:

- a hidden change (a link target) in the same block as a visible one, or next to one, counts as shown;
- a reference definition whose change breaks or mends a link in another block counts as not shown, though that
  block renders differently;
- in the one-page (unified) preview, a changed image source or link target puts the removed part of the address back
  as struck-through text (as with character references, `removed-words-inside-references.md`), so a change counted
  as not shown can look shown there.

A finer check would compare the rendered output per change (the marks the rich diff puts in the text) rather than per
block.
