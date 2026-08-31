---
"@surrounded-by-slop/core": patch
"@surrounded-by-slop/cli": patch
---

An import of a file that the include/exclude filters left out is no longer
reported as "unresolved". `sbs map .` on this repository printed 15 warnings
about test files it had deliberately excluded — a false statement that also
buried any genuinely broken import in noise. Those are now informational and
shown under `--verbose`, while an import that really points at nothing still
warns.

The analyzer cannot tell the two apart, because an excluded file simply is not
in its in-memory file set; diagnostics now carry the import specifier so the
host, which has the filesystem, can classify them.
