# Big pull requests and failures (from the big-PR audit)

Queued, not built. Found by the audit of VS Code-sized pull requests, phones, rate limits and error states:
- the diff editor leaks memory across files (models or editors not disposed);
- the whole file tree re-renders on every F7 or file step;
- requests have no timeout: a stalled one hangs the view; a timeout with a Retry button;
- a 19k-line file freezes a phone;
- silent partial states: "0 commits", or a list cut at 3000 files, without saying so;
- API budget: the Log loads eagerly and cancelled loads still spend requests;
- switching pull requests during a file load can show the old one's file;
- raw error messages from GitHub, and odd URLs (malformed ones) not handled.
