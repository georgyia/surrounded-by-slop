---
"@surrounded-by-slop/cli": minor
---

`sbs` no longer answers with a confident blank when it found nothing to read.
`map`, `analyze`, `export` and `query` now fail with exit code 3 and say which
cause applies — wrong path, a language that is not analyzed, `--include`
narrowing everything away, or a project that is entirely test files — instead
of printing an empty map and exiting 0. Exit codes are documented in `--help`
and the agent guide, so a script or an agent can tell "nothing to say" from
"could not read this".
