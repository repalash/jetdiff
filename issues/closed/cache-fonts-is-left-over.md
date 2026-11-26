# cacheFonts in offline.js is left over

`cacheFonts()` in `js/offline.js` fetched the Google Fonts stylesheet and its files so that the service worker kept
them. The fonts now come from the site (`vendor/@fontsource/…`), and the service worker keeps them at install with the
other libraries the page starts with, so `cacheFonts` finds no Google stylesheet and does nothing: remove it and its
call in `preloadApp`.

Done: cacheFonts() removed (the fonts are served by the site).
