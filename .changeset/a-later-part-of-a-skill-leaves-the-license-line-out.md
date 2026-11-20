---
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

A page of a skill after the first, and a part `skillcdn skill` reads from `--cursor`, no longer says the `License` line again. 0.5.3 said that a later part leaves the license out, and the line stayed: it is written from the license the reader resolved for the skill, not from the front-matter field that was left out. The first page says it as before, and a skill that is only described says it on every answer, since the license is why nothing else follows.
