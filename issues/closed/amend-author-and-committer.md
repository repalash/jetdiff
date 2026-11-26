# Amend: the author and the committer

Waiting for a decision (found in an audit of the git operations).

- With an author saved in Commit Options, Amend replaces the amended commit's author, and its date, with the saved
  one (`author: author || headCommit.author` in `commitFiles`). The IDE's Amend keeps the original author unless
  asked to reset it.
- With no committer given, GitHub's Git data API takes the author as the committer. So an Amend with no saved
  identity records the original author as the committer as well, not the token's account the panel names. Amending
  a teammate's commit makes it look committed by them.

Smallest option: Amend always keeps the original author with its date; the committer is the saved committer, else
the saved author, else the token's account (from `/user`, with the noreply email when the email is private).
Alternatives: the same, plus a "Reset the author" checkbox shown only with Amend; or only fix the committer and keep
the saved author replacing the original one, as now.

Done (the smallest option): Amend keeps the original author with its date; the committer is the saved committer, else
the saved author, else the token's account (`accountIdentity`, the noreply email when the email is private), in
`commitFiles`. The Commit panel and Commit Options say so.
