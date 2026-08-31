---
"@surrounded-by-slop/cli": patch
---

`sbs impact` now says "not a git repository" when run outside one, instead of
passing through git's own usage dump. Outside a repo git falls back to
`--no-index` mode and complains that `--staged` is an unknown option — an error
about a flag the CLI passed, for a mode the user never asked for, printed in
whatever language their git is localized to. Other git failures are reported as
a single attributed line with git's stderr captured rather than leaked mid-
command. A piped diff (`git diff | sbs impact -`) still needs no repository.
