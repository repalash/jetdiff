# Some JetBrains keys never reach the page in a browser

The JetBrains keymap (js/keymap.js) binds keys that browsers keep for themselves, so in a browser tab they do the
browser's thing instead (the tests pass, as Playwright sends keys to the page directly):

- Windows/Linux: Ctrl+W (Extend Selection) closes the tab and Ctrl+Shift+W (Shrink Selection) the window in Chrome;
  Shift+Alt+→ / ← (Monaco's own Expand/Shrink Selection) still work. Ctrl+Shift+J (Join Lines) opens the DevTools
  console.
- macOS: ⌘⌥← / ⌘⌥→ (Back, Forward) switch tabs in Chrome; ⌘[ / ⌘] work.
- Linux desktops: Ctrl+Alt+← / → (Back, Forward) often switch workspaces before the browser sees them.

Options: other keys for these actions in a browser (which ones is a choice), or a note in the README. An installed app
window (PWA) may let some of them through; not checked. Asked on 26 Nov 2026 (keep both keys, only the browser-safe
ones, or only IntelliJ's): put off for later. What a browser cuts off today is Join Lines on Windows/Linux, and Back and
Forward on ⌘⌥←/→ and on Linux desktops' Ctrl+Alt+←/→; Extend and Shrink Selection keep Monaco's Shift+Alt+→/←.
