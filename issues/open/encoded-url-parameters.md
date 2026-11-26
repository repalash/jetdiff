# The page's URL shows its parameters percent-encoded

The URL is written with `URLSearchParams`, which encodes `/` and `,`: `?pr=owner%2Frepo%2F123&tabs=log%2Ctimeline`
instead of `?pr=owner/repo/123&tabs=log,timeline`. Both forms open the same view; the readable one would be nicer to
share and to read in the address bar.
