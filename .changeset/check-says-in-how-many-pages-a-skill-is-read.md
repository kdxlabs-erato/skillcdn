---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

`skillcdn check` says for each skill how large its context is and in how many pages an agent reads it: `context: 42459 bytes, read in 3 pages (rules 19, instructions 20, included 42420)`. A skill whose instructions and included files are over the 16 KiB the format recommends gets one line more, with what each included file weighs, the largest first, and the report's notes count such skills (`skill_large`). It is a note: the exit code is as before.

The pages are counted by the function the reader cuts them with: `pageOfContext` and `countContextPages` are new in `@skillcdn/core`.
