# The VS Code keymap has no keys for Back and Forward

VS Code's Go Back / Go Forward are Ctrl+- / Ctrl+Shift+- on macOS, Ctrl+Alt+- / Ctrl+Shift+- on Linux and Alt+← / Alt+→
on Windows. Each clashes with an app key: ⌃- and Ctrl+Shift+- with the editor font keys (main.js `onKey` takes Ctrl as
well as ⌘ on a Mac), Alt+← / Alt+→ with Previous/Next File. With the VS Code keymap, Back and Forward are only in Search
Everywhere for now. A decision: which keys (or narrowing the font keys to ⌘ on a Mac). Asked on 26 Nov 2026 (VS Code's keys with the font keys on ⌘ only on a Mac, JetBrains' keys, or none): put off for later.
