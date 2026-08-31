---
"@surrounded-by-slop/host": minor
"surrounded-by-slop": patch
---

Build output and installed dependencies are now skipped for every supported
language, not just JavaScript. Rust and Maven `target/`, MSBuild `obj/`,
`.gradle/`, Python's `.venv` / `venv` / `__pycache__` / `site-packages` /
`.tox` / `.mypy_cache` / `.pytest_cache`, and Ruby's `.bundle` previously
landed on the map: a repo map spent its token budget on vendored code, ranking
was skewed toward dependencies, and a real `.venv` could exhaust the 5,000-file
cap before the project's own source was reached.

`packages/` and `bin/` are deliberately still analyzed — NuGet and C# use them
for output, but they are also the source root of most monorepos and where many
JS and Python projects keep real entry points.
