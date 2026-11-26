# Steps in the Markdown preview ignore scrolling

In the code views a step goes on from the middle of the view once the user scrolled (js/steps.js `StepOrigin`). The
Markdown preview always goes on from the block it marked last (`state.mdCur` in js/main.js): after scrolling far down,
F7 goes back up to the block after the marked one, and the "Press again" tip shows at a block that may be off screen
(it is then clamped to the edge of the pane).

A fix would track scrolling of the preview's panes like `StepOrigin` does, and pick the first stop below the middle of
the pane (`mdStops` gives the blocks).
