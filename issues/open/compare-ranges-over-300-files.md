# Compares and commit ranges stop at 300 files

GitHub's compare API lists at most 300 changed files, on its first page only (later pages hold more commits, not more
files). A compare, a two-dot compare and a range of a pull request's commits (`a..b`, in `loadChangeSet`) now say that
the list may be incomplete when it reaches 300; the commit log's file list for a selected range (`getCommitFiles`)
does not. Listing all the files needs another source, such as comparing the two commits' trees (`git/trees`, per
directory as `headEntries` does), and those requests in snapshots too.
