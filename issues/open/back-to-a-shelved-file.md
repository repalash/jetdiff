# Back from a declaration does not return to the shelved file shown

Go to Declaration from the current version of a shelved file (the right side of the Shelf's comparison) works, but
Back then shows the head's file on its own (`side: 'outside'`), not the comparison with the shelved text; from the
shelved text (the left side) it finds nothing, as that text is at no commit. A location could name the shelved file
shown ({id, path}) so that Back shows it again.
