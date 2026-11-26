# Cloudflare injects its Web Analytics script, which the CSP blocks

jetdiff.com's pages get `https://static.cloudflareinsights.com/beacon.min.js` added by Cloudflare (Web Analytics with
automatic setup on the zone), and the Content Security Policy blocks it: an error in every page's console, and no
analytics. Either turn the automatic injection off in the dashboard (Web Analytics, or the zone's settings), or allow
the beacon: `script-src https://static.cloudflareinsights.com` and `connect-src` already allows its reports (https:).
A decision for the maintainer: whether jetdiff.com has analytics at all.

Done: the maintainer chose to keep analytics; `script-src` allows https://static.cloudflareinsights.com.
