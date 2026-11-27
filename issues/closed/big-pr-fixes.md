# Big pull requests and failures (from the big-PR audit)

Found by the audit of VS Code-sized pull requests, phones, rate limits and error states:
- the diff editor leaks memory across files (models or editors not disposed);
- the whole file tree re-renders on every F7 or file step;
- requests have no timeout: a stalled one hangs the view; a timeout with a Retry button;
- a 19k-line file freezes a phone;
- silent partial states: "0 commits", or a list cut at 3000 files, without saying so;
- API budget: the Log loads eagerly and cancelled loads still spend requests;
- switching pull requests during a file load can show the old one's file;
- raw error messages from GitHub, and odd URLs (malformed ones) not handled.

Done, each with its test in `tests/big-pr.spec.js` (`fakePr` answers its lists a page at a time, and the commit and
Viewed queries):
- Memory: Monaco 0.52's `DiffEditorWidget.setModel({original, modified})` makes a view model it never disposes, which
  kept every pair of models shown (60 text models alive after 30 files, with their tokens and listeners). The diff
  editors now show a view model of ours, disposed when the next pair shows (`setDiffModels`); 2 models stay alive.
  Image previews revoke their object URLs. Editors, decorations and listeners were already constant.
- Tree: `FileTree` redraws only the rows a selection, a Viewed mark or an edit changes (3000 files: a selection took
  186 ms and a step drew the tree three times; now 10 ms, a mark 0.1 ms instead of 40).
- Timeouts: a request that gets no answer, or no more of its body, for 30 s is given up (`fetchOrStall`, also for
  snapshot files); the change set (on the start page), the file, the Timeline and the Log's files say so, with Retry.
- Huge files: tokenizing both models whole up front took 39 of the 41 s a 19,000-line file froze a phone (4× CPU
  throttling); now Monaco tokenizes what is shown, and only the unified view's original, when under 1000 lines and with
  deletions, is tokenized up front (2.3 s to show, longest task 0.4 s). A Markdown file over 3000 lines opens as code
  (its 19,000-line preview froze a phone for 5 to 13 s, in DOMPurify, `hiddenChanges` and layout), and Preview shows it.
  Diff computing runs in Monaco's worker, and the connectors took under a second.
- Partial data: notes over the view, until closed, for commits that could not be read, a pull request's commits past
  GitHub's 250 and a compare's past 300, Viewed marks that could not be read, the cut file lists and the missing merge
  base (those two were toasts); the Log for a commit's or range's files cut short; the Timeline for comments past its
  500 and inline comments or reactions not read.
- API budget: the Log reads the selected commit's files when first shown; a load a newer one replaced is aborted (the
  change set, a file and its read-ahead, the Timeline, the Viewed states, the Log's selection, the pull request search).
  File contents are shared between callers and aborted only when none waits for them.
- Switching: opening another pull request drops the change set shown before at once (`openTarget`), so a file of it
  still loading never shows, and no step or mark acts on the old list meanwhile.
- Errors: in plain words, with what GitHub (or the browser) said kept as the detail; a malformed `?pr=`, `?commit=`
  or `?compare=`, a path that is no GitHub link (404.html now passes it as `?path=`) and a `file=` not among the changes
  say why.

Filed: unified-deleted-lines-colors.md, monaco-diff-view-model-leak.md, contents-kept-in-memory.md,
files-pages-one-after-another.md.
