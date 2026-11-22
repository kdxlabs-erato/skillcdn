---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

A page of a skill, and a part `skillcdn skill` prints, ends between two blocks of Markdown where it can (ADR-0118): outside a table and a fenced code block, and not right after a heading or a line that ends in a colon, when such a place is within 4,096 characters of where the page would end. A rule or a file that begins late on a page with no such place begins the next one. A table longer than that is still cut after a row, and the page that goes on with it says the table's first two lines again above its text; the REST skill route answers them as `tableHead`, beside the text and not in it. Cursors stay good: they are offsets into the same context.

The first page of `load_skill` names what it shortened: an `Abbreviated above:` line says which of the description, the metadata and the warnings were, and the references beyond the five it resolves are named by the files they point to, with the count of any it has no room for. It said only that something was abbreviated.

In `@skillcdn/core`, `contextLinesPage` takes `mayBeEmpty`, `tableHeadAt` is new, and a `SkillResult` may carry `tableHead`, `detailsAbbreviated` and `referencesUnlisted`.
