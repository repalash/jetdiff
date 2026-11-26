# Check jetdiff.com after each deploy

CI tests on `wrangler dev`, but nothing checks the live site after a deploy (the redirect loop on library files was
found by hand). A short post-deploy job: open jetdiff.com in Playwright, count redirects and console errors, and check
that the service worker keeps the libraries.
