# The VS Code keymap has no keys for Back and Forward

VS Code's Go Back / Go Forward are Ctrl+- / Ctrl+Shift+- on macOS, Ctrl+Alt+- / Ctrl+Shift+- on Linux and Alt+← / Alt+→
on Windows. Each clashes with an app key: ⌃- and Ctrl+Shift+- with the editor font keys (main.js `onKey` takes Ctrl as
well as ⌘ on a Mac), Alt+← / Alt+→ with Previous/Next File. With the VS Code keymap, Back and Forward are only in Search
Everywhere for now. A decision: which keys (or narrowing the font keys to ⌘ on a Mac).
