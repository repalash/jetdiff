# Monaco's diff editor never disposes the view model setModel makes

`DiffEditorWidget.setModel({original, modified})` in Monaco 0.52 wraps the view model it creates in
`RefCounted.create(vm, this)` and passes it to `setDiffModel`, which takes a new reference of its own; the first one is
never released, so the count never reaches 0 and the view model is never disposed. It keeps both models (and their
tokens), its autoruns observe the editor's options, and its listeners stay on the models: jetdiff kept every file it
had shown (60 text models alive after 30 files).

jetdiff now creates the view model itself (`createViewModel`, public API) and disposes it once the next pair shows
(`setDiffModels` in js/main.js).

To do: report it to VS Code (`src/vs/editor/browser/widget/diffEditor/diffEditorWidget.ts`, `setModel`); on the Monaco
0.57 port (monaco-0.57-port.md), check whether it still leaks (tests/big-pr.spec.js counts the live models).
