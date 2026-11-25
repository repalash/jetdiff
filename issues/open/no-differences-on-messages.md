# "No differences" shows over a binary file or a load error

`diffInfo` (js/main.js) counts no differences when the view shows a message, so the toolbar says "No differences" for a
binary file, an image or a file that could not load, although the file did change. Only a diff too large to compute
says so instead ("Too large to compare").
