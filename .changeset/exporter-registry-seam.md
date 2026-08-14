---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": patch
---

Export formats now come from one list. `builtinExporters` and
`createDefaultExporterRegistry()` are exported from core, registries can look
an exporter up by file extension, and the extension's export command and save
dialog both read from the registry instead of hardcoding the format list. A
new exporter is now one module plus a registration, as the `Exporter` contract
always promised. Registering two exporters that claim the same file extension
is now an error rather than a silent shadow.
