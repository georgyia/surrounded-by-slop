---
"@surrounded-by-slop/host": patch
---

The extension manifest's `slop.include` default and the shared
`DEFAULT_INCLUDE` can no longer drift apart unnoticed: a manifest test compares
the extensions they cover and fails naming both the missing suffix and the file
to fix. They had already drifted — the editor gained five languages the shared
default never got, so the CLI quietly analyzed fewer languages than the editor.
