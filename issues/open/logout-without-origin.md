# Sign-out requests without an Origin header

Later pile (Q33). `/auth/logout` accepts requests from the site's own origin only. A request with no Origin header
(some browsers or privacy tools strip it) is refused; whether to allow it (e.g. with Sec-Fetch-Site) is open.
