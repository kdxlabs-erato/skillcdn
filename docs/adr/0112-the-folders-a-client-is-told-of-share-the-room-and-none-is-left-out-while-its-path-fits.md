# ADR-0112: The folders a client is told of share the room, and none is left out while its path fits

- Status: Accepted
- Date: 2026-11-20
- Builds on [ADR-0022](0022-repository-paths-and-progressive-skill-loading.md) (a connection is told of the folders, not of every skill). Concerns [ADR-0012](0012-what-a-client-is-told-and-offered.md) (the instructions stay under 2,000 characters).

## Context

The instructions of a connection introduce every top-level folder that holds something discoverable in a line: its path, its name, its description and what it holds. The lines were written one after another, each whole, until one did not fit in the 2,000 characters; that one and every folder after it in path order were left out, and nothing said so. A pack of seven folders with a description each already filled the room, so its next folder would have taken the last one's line away: an agent would read a pack that looked complete and had no such folder.

What an agent needs of a folder in order to go on is its path. The description is the part of the line it can do with less of: a folder's own listing says the rest.

## Decision

1. **Every folder keeps its line while the lines fit by saying less.** With room, a line is whole, as before. Without, the descriptions are cut to one length for all of them, the greatest that fits, so that a short description stays whole and the long ones give way. Below 24 characters a description is a stub: the descriptions are left out instead. Then the names are cut the same way, and below 16 characters left out. The path and the counts stay.
2. **A folder is left out only when the paths and counts alone do not fit.** The lines that fit are written, and one line says how many folders are not listed, before the line that says the browse read returns the full contents.
3. **The same holds where the rows are skills**, in a catalog without folders.
4. **The bound stays 2,000 characters.** What the summary, the manifest and overview lines and the lines on the reads take is as it was; the rows share what is left.
5. **`skillcdn check` says what the bound cost**: beside the length of the instructions, that the folder lines say less, or how many of them are left out. `fitInstructions` of `@skillcdn/core` answers the text with those numbers; `renderInstructions` is its text.

## Consequences

- **A pack that fits is told as before**, character for character.
- **A pack that grows loses words before it loses folders.** Measured on the reference pack, whose seven folders filled the room: with an eighth, every line stays and the descriptions are cut from 100 characters to 88; with thirteen, to 40.
- **The catalog counts the folders it is not given.** A catalog holds the first 50 entries of the mounted folder that hold something, and how many there are (`groupCount`, in the `mounts` answer too), so that the line counts the ones beyond them as well.
- **An author sees it before a client does**, in the report of `check`, and can shorten the pack's description or the folders' own to choose what is cut.
- **Rejected:**
  - naming the folders left out in one closing line: with the descriptions sharing the room, folders are left out only when their paths do not fit either;
  - a larger bound: a client cuts the instructions there, and the instructions are paid for in every conversation;
  - cutting from the end, as before, with a line that says so: the folder an agent needs is as likely the last as the first.
