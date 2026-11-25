# A diff Monaco cut short is shown as if exact

Past `maxComputationTime` (20 s) Monaco gives a coarser diff (`quitEarly`); the page shows it like any other. Monaco
0.52's standalone diff editor has no public way to read `quitEarly` (`getDiffComputationResult` is not there), so
saying it would need that API.
