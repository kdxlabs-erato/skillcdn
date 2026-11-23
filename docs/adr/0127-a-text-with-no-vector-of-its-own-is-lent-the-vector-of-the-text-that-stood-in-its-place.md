# ADR-0127: A text with no vector of its own is lent the vector of the text that stood in its place

- Status: Accepted
- Date: 2026-11-24
- Builds on [ADR-0107](0107-a-commit-just-indexed-is-given-the-vectors-its-texts-had-already.md) (a commit just indexed is given the vectors its texts had already), [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (the commit a ref was served from before) and [ADR-0126](0126-an-entry-still-to-be-embedded-keeps-the-place-its-words-give-it.md) (an entry still to be embedded keeps the place its words give it). It amends the second consequence of ADR-0107.

## Context

A commit just indexed is given the vectors its texts had already, by the hash of each text (ADR-0107). A text is a section under its title and heading path, or a skill's name and description. A document given a new title, a skill given a new description and a file said anew have no text that says what one said before, so nothing was given them, and they waited for the worker with no vector at all.

Such an entry keeps the place its words give it meanwhile (ADR-0126). A question that shares no word with it, one asked in another language for one, finds nothing of it until the worker has embedded it: the minutes its job waits behind the slices of other packs.

## Decision

1. **A text with no vector of its own is lent the vector of the text that stood in its place** in the commit the ref was served from before, when its commit is indexed, with the vectors ADR-0107 gives and under its conditions.
2. **The place is the path, and a place within the body.** For a skill's head it is the head. For a section it is the section under the same headings below the first, which is the title as a rule, the second such for the second. Where the two bodies are cut into as many sections, a section whose headings are new takes the section at the same place in their order.
3. **The row names the section as the commit has it**: its heading path, offset and length. A search names and reads the commit's own passage.
4. **A vector lent is never taken for the text's own.** It is written without the hash of a text, so that no other body is given it (ADR-0093). Its body is written as unfinished, so that it counts as not embedded and the worker embeds it whole. The write that ends the body drops the vectors lent to it, with the parts and the copies at half precision made of them, in the same transaction.
5. **A private repository is lent nothing.** A vector is kept under the hash of a body, for every repository that holds the same bytes. The vectors a body is given are made of its own text. One lent is made of what the repository said before, which another repository that holds the same bytes has no part in.

## Consequences

- **An entry said anew under the same path is found by what the path meant**, by a question in other words or in another language, for the minutes its embedding takes.
- **Where a file was rewritten to say something else, a question about what it said still finds it for that long**, and the passage it names is what the file says now.
- **An entry under a new path is lent nothing.** A skill whose directory was renamed is found by its words (ADR-0126), by the texts whose hash still has a vector, and by the files of it that did not change.
- **The progress of an embedding counts a body that holds lent vectors as not embedded**, as it counts every unfinished body.
- **Indexing a changed commit costs one more read**: the entries of the commit before, and each body replaced, with its vectors.
- **Rejected:**
  - following a rename by the git host's comparison of two commits: an index is read from the tree of one commit, a comparison is one more call for every index, and a pack read from a directory has no host to ask; inferring a rename from the texts needs a measure of likeness and a threshold nobody has measured;
  - a second hash kept with every vector, of the section without its title and heading path, to find a retitled section by: no vector written so far has one, and the place under the same path finds the same section without it;
  - counting a body that holds lent vectors as embedded: the line would say the embedding is done while the worker still has the body to embed;
  - lending to a private repository as well: its vectors would rank, for a while, another repository that came to hold the same bytes.
