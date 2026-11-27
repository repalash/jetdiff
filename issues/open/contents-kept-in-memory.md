# File contents read in a tab stay in its memory

`getFileContent` keeps every file it read in `contentCache` (js/github.js) until the tab closes or the repository's
data is removed: the files shown, those read ahead, those Go to Declaration searched and those the TypeScript service
loaded. Opening hundreds of files of a big pull request, or a few huge ones, grows the tab by their size (measured: the
heap grows by about the files' text, some 15 KB a file of 300 lines, once the diff editors' leak was fixed). Contents at
a commit are also in Cache Storage (`jd-contents-v1`), so the memory copy could be bounded (the last files, or a size)
and read again from there.
