# Menus reopened in place add outside-click listeners

Menus that reopen with `keepOpen` (font size, theme) add another outside-click listener each time without removing the old one. Harmless, but they pile up while the page is open.
