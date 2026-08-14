---
"surrounded-by-slop": patch
---

The "opened N modules as folders" notice is now dismissible. It offers
"Don't show again" and remembers the answer across sessions, while the folding
behaviour itself stays on and keeps following `slop.foldThreshold`. A new
**Slop: Reset Suppressed Notices** command brings dismissed notices back, so
the choice is not a one-way door. The hard large-workspace guardrail message is
unchanged — it fires rarely and explains a much bigger surprise.
