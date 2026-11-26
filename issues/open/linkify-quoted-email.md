# A quoted e-mail address links with its quote

With linkify-it 6.1.0 (markdown-it 15), `sub: 'me@example.com'` in Markdown text becomes a link to
`mailto:'me@example.com` that takes the opening quote in (code quoted outside a code block, in a comment or a Markdown
file). markdown-it 14 left it as text; GitHub links `me@example.com` without the quote. An apostrophe is allowed in an address's local part,
but not as its first character after a quote. Report it to linkify-it (github.com/markdown-it/linkify-it) and take the
fixed release.
