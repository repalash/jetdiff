# A big file's deleted lines show without colors in the unified view

The unified view (Monaco's diff editor, inline) draws the deleted lines in view zones, with the tokens the original
model has when they are drawn. Monaco 0.52 means to draw them again once its background tokenizer has finished the
original (`diffEditorViewZones.js`: `originalModelTokenizationCompleted`), but that observable listens to
`onDidChangeTokens` and reads `backgroundTokenizationState`, which turns Completed only after the last token event (in
`backgroundTokenizationFinished`, which fires `onDidChangeBackgroundTokenizationState` instead). So the zones are never
drawn again.

`openFileAt` tokenizes an original of up to 1000 lines up front (`TOKENIZE_UP_FRONT`) so its deleted lines show in
color; a bigger one is left to Monaco (tokenizing 19,000 lines up front froze a phone for 40 s), and its deleted lines
stay plain. The side-by-side and aligned views are not affected.

To do: report it to VS Code (the code is the same in `src/vs/editor/browser/widget/diffEditor`), check whether Monaco
0.57 (monaco-0.57-port.md) still has it, and once fixed drop the up-front tokenizing.
