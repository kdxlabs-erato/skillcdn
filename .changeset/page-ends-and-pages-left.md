---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A page of a skill keeps whole every line that fits a page, counts its reach in bytes, and says how many pages are left; `skillcdn check` says where a page ends inside something ([ADR-0123](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0123-a-page-of-a-skill-counts-its-reach-in-bytes-and-keeps-whole-a-line-that-fits-a-page.md)).

- **A line is cut only when it is longer than a page.** A page whose bytes ran out more than 2,048 characters into a line ended between two words of it; it now ends before the line. A line longer than a page is cut between two words, and never before a combining mark, a joiner or the vowel or final consonant of a Hangul syllable written in its letters.
- **The place between two blocks is looked for within 4,096 bytes**, a quarter of a page, where it was 4,096 characters. Text of one byte a character is paged as before. Text of three bytes a character has pages three quarters full at least, where they could be half full, and keeps a table or a code block whole up to some 1,300 characters, where it was some 2,700.
- **A page of a skill read in more than one says how many pages follow it**, in the line that names the next `load_skill` call and once more as its last lines, and the last page says that the skill is complete. Run with a command-line agent, two models that read a skill of seven pages to its end in none of six runs did in ten of eleven. The REST API answers the count as `pagesLeft`; the command's parts say as before.
- **`skillcdn check` lists, under each skill, the pages that end inside a table, a code block or a line**, with the file and the line the next page begins at, and notes the ones that end inside a code block or a line as `page_cut`. A note fails nothing.
- `@skillcdn/core` adds `contextPageCuts`, `CONTEXT_BLOCK_REACH` and the type `ContextCut`; `countContextPages` takes where to count from, and `contextLinesPage` what a page holds (`pageBytes`).

Cursors stay good, and the reading rules do not change.
