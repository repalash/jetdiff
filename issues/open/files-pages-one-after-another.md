# A big pull request's files are read a page at a time, one after another

`loadChangeSet` reads a pull request's files with `paginate`, 100 a page, each page asked once the one before arrived:
3000 files are 30 round trips before the page shows anything (several seconds on a phone network). The pull request's
`changed_files` says how many pages there are, so the pages after the first could be asked together (a few at a time),
once the pull request's answer arrived. The same holds for a commit's files (`loadCommit`) and the Timeline's lists.
Without a token that spends the hourly 60 requests just as fast, but no faster than now.
