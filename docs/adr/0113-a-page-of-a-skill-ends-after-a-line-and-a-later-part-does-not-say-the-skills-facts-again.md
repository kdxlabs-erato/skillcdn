# ADR-0113: A page of a skill ends after a line, and a later part does not say the skill's facts again

- Status: Accepted
- Date: 2026-11-20
- Builds on [ADR-0108](0108-the-command-prints-what-a-host-shows-whole-and-a-long-skill-in-parts.md) (the command prints a long skill in parts) and [ADR-0110](0110-the-reads-of-the-command-are-a-library-for-other-commands.md) (the reads are a library); amends the second consequence of ADR-0108.

## Context

A skill's context is read in pages of 16 KiB, and a page ended where its bytes ran out: inside a word as often as not. A part the command prints is a run of those pages, so a part of one skill ended with `col` and the next began with `lected`. An agent that reads a part at a time acts on what it has read, and half a word or half a sentence is the last thing it has read.

The command also printed every part as if it were the first. Each part repeated the description, the license, the list of the skill's files and its references, some 3,800 characters for a skill of the reference pack, and named every included file under its heading even where the part held nothing of it: a part of that skill carried ten headings with nothing under them but the line that says a file continues. Over MCP a page after the first already leaves all of that out. The line that marks a cut section named "the next skillcdn skill page", while the command speaks of parts.

## Decision

1. **A page of a skill's context ends where a reader can stop.** Where the context goes on after the page, the section the page cuts ends after its last line end when one is within 2,048 characters of where the bytes run out, else after its last space within 256, else where the bytes run out, as before. The next page begins where this one ends: the cursor is an offset, and the pages are still the context and nothing of it twice. This is the reader's, so a page over MCP, a page of the REST API and a part of the command end the same way.
2. **A part read from a cursor names the skill and does not say its facts again.** It carries the skill's name, its source, where relative paths start and whether the context is complete; the description, the license, the lists of files and references were in the first part. Warnings stay: they may be why the skill cannot be used.
3. **A part names an included file only where it has some of it.** A part that is not the whole skill leaves out the files read before it and the ones the next parts bring.
4. **A section a part cuts continues "in the next part".** The words a caller hands in may name what the next read of a skill is called (`piece`); over MCP it stays the next page of the tool.

## Consequences

- **A line of a skill is in one part.** A line longer than 2,048 characters is still cut, between two words where it has any.
- **A page holds up to 2,048 characters less than it could**, so a skill may take a page more than before. Cursors handed out before the change stay good: they are offsets into the same context.
- **The parts of a long skill are shorter by what they repeated**, and an agent that reads two parts reads the facts once.
- **A part after the first does not stand alone.** It never did: its cursor comes from the part before.
- **Rejected:**
  - ending a page only at a paragraph or a heading: a page would give up far more than a line's worth, and a long list has neither;
  - cutting at a line in the command alone, as it does for a file: the page over MCP would still end inside a word, and the cursor of a part would no longer be a page's;
  - saying how many parts are left: the answer of a page does not carry the length of the whole, and the last line of a part already says there is more.
