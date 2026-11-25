# Two-dot compares: unknown line counts, and renames split

GitHub's API has no two-dot compare (`compare/a..b` answers 404), so `directFiles` (js/github.js) builds one from the two
three-dot compares, when the base moved on since the head branched off. A file both sides changed shows `+? −?` (the
line counts are known for each side only), and a rename on one side of a path the other side also changed shows as a
removal and an addition.
