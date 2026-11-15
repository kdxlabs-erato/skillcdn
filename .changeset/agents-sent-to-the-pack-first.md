---
"@skillcdn/cli": patch
"@skillcdn/web": patch
---

`skillcdn use` prints a sentence for the checkout's agreement that has an agent run `skillcdn status` before its first step, and names `AGENTS.md` first, or `CLAUDE.md` where that is the file the agents read; the connection guide of the pages says the same. A checkout that carries the earlier sentence keeps working: copy the new one into it to have its agents look at what the checkout reads before they begin.
