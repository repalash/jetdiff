# No » marker at the stepped-to line in the unified and aligned views

The side-by-side viewer draws IntelliJ's `»` before the line number of the line a step went to (js/sbs.js `draw`), in
the room its gutter canvas leaves left of the numbers. The unified and aligned views are Monaco's diff editor, whose
gutter has no such room: the lane between the line numbers and the text holds the diff's + and − signs
(`renderIndicators`) on exactly the changed lines a step goes to, and a glyph margin would widen the gutter.

Options: a `»` in place of the + / − sign on that one line (a decoration with `linesDecorationsClassName`, hiding the
sign under it), or a glyph margin only while a step's marker shows.
