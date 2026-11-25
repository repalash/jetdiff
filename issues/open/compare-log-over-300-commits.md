# A compare of over 300 commits logs its oldest 300

`loadChangeSet` reads three pages of a compare's commits (oldest first), as it reads up to 300 commits of a pull
request, so the Log of a longer compare stops 300 commits after the merge base. The head is then read from
`commits/{head}`, which fails for a head in another fork (`user:branch`).
