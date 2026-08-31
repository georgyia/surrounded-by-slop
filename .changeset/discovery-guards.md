---
"@surrounded-by-slop/host": minor
"@surrounded-by-slop/cli": minor
"surrounded-by-slop": patch
---

Shared discovery now enforces the same guardrails the editor always had: files
over 512 KB are skipped (checked against the `stat` the walk already performs,
so an oversized file is never read into memory), and the walk stops at 5,000
files. Previously only the extension had these, so the CLI and MCP server
ingested a 7 MB generated file the editor would refuse — the same repo gave
different answers depending on where you asked.

Nothing is dropped silently: `discoverFiles` reports every skip with a reason,
`sbs` warns when the file cap truncates a map, and `--verbose` lists the
individual files it passed over.
