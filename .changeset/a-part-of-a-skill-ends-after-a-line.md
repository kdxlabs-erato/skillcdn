---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A page of a skill's context no longer ends inside a word. Where a page cuts a rule or an included file, it ends after the last line that ends within 2,048 characters of where its bytes run out, else between two words; the next page begins there, and cursors handed out before stay good. Pages over MCP, pages of the REST API and the parts `skillcdn skill` prints end the same way. `@skillcdn/core` exports `contextLinesPage`, which cuts so.

`skillcdn skill` and `readPack` print the parts of a long skill without what they repeated: a part read from `--cursor` names the skill and its source and leaves out the description, the license and the lists of files and references the first part gave; a part names an included file only where it has some of it; and a section a part cuts says it continues "in the next part" (`ToolWords` may carry `piece`, the word for it).

A read of a deployment makes fewer requests. `readPack` asks for the mount once where the text names the pack and its commit, and not at all for `rows`, `code` and the reads with `json`; the pack of `openDeployment` asks for what it reads and nothing first, and waits for the index only where the deployment answers that the commit is being indexed. A skill read took two requests for the mount and one more for every page; it takes one. A pack that pages a skill or its listing without end, or answers the same page again, is given up on as `invalid_response` instead of read forever. `@skillcdn/cli` exports `shellWord`, and the default line for the next part quotes a path a shell would split.
