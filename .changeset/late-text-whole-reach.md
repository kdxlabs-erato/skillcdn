---
"@skillcdn/core": patch
---

A page of a skill no longer ends inside a table or a fenced code block shorter than 4,096 characters because its text began late on the page. A rule, a body or an included file that begins after other text on a page is cut within the whole reach, where it was cut within half of the room the page had for it ([ADR-0122](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0122-a-text-that-begins-after-other-text-on-a-page-is-cut-within-the-whole-reach.md)). `pageOfContext`, `countContextPages` and the page counts of `skillcdn check` follow. Cursors stay good, and the reading rules do not change.
