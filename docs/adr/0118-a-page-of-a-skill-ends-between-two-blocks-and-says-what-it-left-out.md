# ADR-0118: A page of a skill ends between two blocks where it can, and its first page says what it left out

- Status: Accepted
- Date: 2026-11-22
- Amends point 1 of [ADR-0113](0113-a-page-of-a-skill-ends-after-a-line-and-a-later-part-does-not-say-the-skills-facts-again.md): a line end is no longer the first place a page looks for. The rest of it stays.

## Context

A page of a skill ended after a line ([ADR-0113](0113-a-page-of-a-skill-ends-after-a-line-and-a-later-part-does-not-say-the-skills-facts-again.md)), and any line would do. Five fresh sessions that read five long skills of the reference pack through `load_skill` wrote down the same things. A page ended inside a table, and the next began with rows under no head. A page ended inside an example of code, after the line `Then:` whose list was on the next page, or with a heading and nothing under it. No page ended inside a sentence: the rule of the line held, and a line was not enough.

The first page also said `Optional details abbreviated` and `Reference list abbreviated` without saying what. A reader told only that something was shortened cannot know whether what it needs is among it: two of the sessions went back to the source to find out, and the references that were left out were files the skills lean on.

## Decision

1. **A page ends between two blocks of Markdown where one such place is in reach.** Where the context goes on after the page, the text the page cuts ends after its last line end that is outside a fenced code block and a table, and not right after a heading or a line that ends in a colon, when one is within 4,096 characters of where the bytes run out and no further back than half of what the page could hold of that text. With none, the page ends as ADR-0113 decided: after a line within 2,048 characters, else between two words within 256, else where the bytes run out.
2. **A text that begins late on a page, with no such place, begins the next page.** Where a rule, the body or an included file begins after other text on the page, and what the page could hold of it is at most 4,096 characters with no place of point 1 in it, the page ends before it.
3. **A page that begins at a row of a table carries the head of that table.** A table longer than the reach is still cut, after a row. The page that goes on with it has the table's first two lines, the row of names and the row under it, beside its text: the tools and the command write them above the first text of the page under a line that says so, and the REST API answers them as `tableHead`. They are not part of the text: the cursor is an offset as before, and the pages are still the context and nothing of it twice.
4. **The first page names what it shortened.** `Abbreviated above:` lists which of the description, the metadata and the warnings were, with how many of how many, and says that the instructions are whole. The references beyond the five that are resolved are named by the file each points to, as far as 1,024 bytes of paths go, with the count of the rest.

## Consequences

- **A table, an example of code, a heading with its first paragraph, and a line with the list it opens are read on one page**, unless the block is longer than the reach.
- **A page may hold up to 4,096 characters less than it could**, twice what ADR-0113 gave up, so a skill of many tables may take a page more. Cursors handed out before the change stay good: they are offsets into the same context.
- **What a block is, is read from the text alone**: a fence of three or more backticks or tildes, a row of bars over a row of dashes, a line of one to six number signs. A table without bars at its edges, a heading underlined with dashes and an indented code block are lines like any other.
- **A reader of the JSON that shows a page alone** places `tableHead` itself; one that joins the pages ignores it.
- **Rejected:**
  - saying the head again as part of the text of the page: the pages joined would hold the head twice, and the command prints a skill whole from its pages;
  - closing and opening again the fence of a block of code that is cut: there is no head to lose, and the lines of the example read on as they are;
  - listing every reference in full on the first page: the list is unbounded, and the paths alone say what a reader needs to choose;
  - a reach of a whole page: a text of nothing but one long table would never be read.
