# F7 while editing can move the focus out of the editable side

A step puts the caret, and the focus, in the side the user is in when the difference has lines there, else in the side
that has them (js/sbs.js `goTo`, js/main.js `uniGoTo`), as asked. In edit mode that means F7 onto a pure deletion moves
the focus from the editable right side to the read-only left side: typing then does nothing until a click back.

The right side's caret is still put on the line below the deletion, so focusing the right side there instead would
keep typing going. Options: keep the focus on the editable side in edit mode, or leave it as it is (it matches the
rule everywhere else).

Done: a step keeps the caret and the focus in the side the user is in, as the IDE does; on a side without lines in the
change, the caret goes to the line where the change is (js/sbs.js `goTo`, js/main.js `uniGoTo`).
