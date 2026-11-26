# DOMPurify 3.2.4 has published advisories

The pinned DOMPurify 3.2.4 (the version the page used from esm.sh, kept when the libraries moved to npm) is below the
fixes of the advisories `npm audit` lists (up to 3.4.16; 3.5.0 has them all). Most concern options jetdiff does not use
(`IN_PLACE`, `RETURN_DOM`, `SAFE_FOR_TEMPLATES`, `CUSTOM_ELEMENT_HANDLING`, function forms of `ADD_TAGS`), but some are
mutation XSS in the default mode. Upgrade (`npm install --save-exact dompurify@<version>`, then `npm run vendor`) and run the
tests, in particular `tests/security.spec.js`.
