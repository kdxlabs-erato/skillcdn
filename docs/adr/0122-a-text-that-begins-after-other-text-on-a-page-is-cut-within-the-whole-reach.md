# ADR-0122: A text that begins after other text on a page is cut within the whole reach

- Status: Accepted
- Date: 2026-11-22
- Amends point 1 of [ADR-0118](0118-a-page-of-a-skill-ends-between-two-blocks-and-says-what-it-left-out.md): the half that bounds how far back a page looks for a place between two blocks holds for the text a page begins with, and no longer for a text that begins after other text on the page. The rest of it stays.

## Context

A page of a skill ends between two blocks of Markdown where such a place is within 4,096 characters of where its bytes run out, and no further back than half of what the page could hold of the text it cuts ([ADR-0118](0118-a-page-of-a-skill-ends-between-two-blocks-and-says-what-it-left-out.md)). A text that begins late on a page, with no such place in the 4,096 characters or fewer the page could hold of it, begins the next page.

Between the two a block shorter than the reach was still cut. Every skill of two served packs was read to its last page: of the 73 places where a page cut a text, one was inside an example of code of 3,089 bytes. An included file began after the skill's body with room for 5,090 of its characters, its example began some 2,400 characters in and ran on past them, and half of 5,090 did not reach back to where the example began. The page ended after a line of the example.

The half is there so that a page is not left short by what it gives up. A page that already holds other text before the one it cuts is not left short: with fewer than 8,192 characters of room for the text, more than half of the page is taken before the text begins.

## Decision

1. **A text that begins after other text on a page is cut within the whole reach.** The place between two blocks is looked for within 4,096 characters of where the bytes run out, or within all the page could hold of the text where that is less. The half bounds the reach only for the text a page begins with.
2. **Nothing else of ADR-0118 changes**: what a place between two blocks is, the text that begins the next page when the page could hold 4,096 characters of it or fewer with no such place, the head of a table said again, and the line end, the space and the byte a page falls back to.

## Consequences

- **A table or an example of code no longer than the reach is read on one page**, wherever on a page its text begins. Read again with the rule, the same skills take the same 113 pages, the page that ended inside the example ends before it, and no page is shorter than before.
- **A page that holds other text may give up 4,096 characters of the text it cuts**, where it gave up half of the room at most. In a text whose characters take three bytes each, a page that held little before that text may then end well under half of its bytes.
- **The page a text begins is as before**: there the half still holds, so a text of such characters is cut within some 2,700 of them.
- **Cursors handed out before the change stay good**: they are offsets into the same context, and the reading rules do not change.
- **Rejected:**
  - no half at all: a page that begins with a text of nothing but long blocks could end a quarter full, page after page;
  - a bound in bytes on the whole page, in place of the half: the same pages for the texts read, at the price of a rule that needs what the page held before each text to be said.
