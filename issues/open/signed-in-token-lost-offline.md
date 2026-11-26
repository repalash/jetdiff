# Offline, a signed-in token about to expire is forgotten

`renewToken` (js/github.js) clears the token whenever `/auth/refresh` fails, a network error included. Opened with no
network within a minute of the token's expiry, the page signs the user out, though the refresh cookie would still
renew it once online. A failed request (TypeError) could keep the token and try again on the next request.
