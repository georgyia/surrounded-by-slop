---
"@surrounded-by-slop/host": minor
---

Resolve imports between workspace packages to their source instead of treating
them as external dependencies. In a monorepo this restores every cross-package
edge, so the folder-level overview shows real package→package dependencies
rather than a set of disconnected boxes.
