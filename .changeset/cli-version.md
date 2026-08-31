---
"@surrounded-by-slop/cli": minor
---

`sbs --version` (and `-v`) now prints the version instead of failing with
"unknown command". The MCP server reports that same version to its clients
rather than a hardcoded `0.0.1` that never tracked `package.json` — a client
showing a stale version made every bug report quoting it misleading. The value
is inlined at build time, so nothing is read from disk at runtime and the two
cannot disagree.
