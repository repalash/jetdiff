# Sign in instead of pasting a token

A "Sign in with GitHub" button (an OAuth app or GitHub App; the token exchange needs a small server, since GitHub's
token endpoint does not allow browser requests). The token-in-settings path stays for those who prefer it.

Done: a GitHub App with expiring user tokens; the Worker (`worker/auth.js`) exchanges the code and renews the token
from an HttpOnly refresh cookie. Pasting a token still works.
