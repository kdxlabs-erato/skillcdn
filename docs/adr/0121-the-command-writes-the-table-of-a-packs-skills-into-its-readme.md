# ADR-0121: The command writes the table of a pack's skills into its README, between two comments

- Status: Accepted
- Date: 2026-11-22

## Context

An agent is given the list of a pack's skills by the tools, from the index. The people who open the repository at its git host read a README, and the list there is kept by hand: a copy of each skill's name and description that nothing holds to the skills. In the reference pack one description stood in six places, the count of skills in the root README was wrong by two, and an area was missing from the introduction. The pack's own check looked only for whether a name was there.

The command already reads a directory as the index would and knows every skill in it.

## Decision

1. **`skillcdn catalog` makes the table.** The skills of a directory that a search would list, in path order: the name of each, linked to its `SKILL.md`, and the first sentence of its description, then how many there are. Printed for the whole pack, or for the skills under `--folder`.
2. **`--write <file>` writes it between two comments of a file.** What stands between `<!-- skillcdn:catalog -->` and `<!-- /skillcdn:catalog -->` is written again; the comments stay, and the rest of the file is not touched. The region lists the skills under the folder the file stands in, or under the folder the opening comment names from the root of the pack, `<!-- skillcdn:catalog folder=marketing -->`, with links written from the file. A file may hold several regions.
3. **`--check <file>` writes nothing and fails when a region is not what `--write` would make it**, with `1`, so that a job holds the README to the pack.
4. **The first sentence is the row.** A description is cut after its first sentence end that a space and a capital, a digit or a quotation mark follow, or at 200 characters.
5. **Nothing of this is the format.** The comments mean something to the command alone. The index reads a README as it did, and the server runs nothing.

## Consequences

- The table a person reads is made from what an agent is given, and a job fails when the two part.
- A row holds one sentence where an author may have written three: what does not fit the row belongs in the skill's own description or beside the table.
- A pack that lists its skills in another shape, by area in prose or with columns of its own, keeps doing so by hand; `skillcdn skills --json` has the data.
- **Rejected:**
  - an option of `check` for the regions: `check` reports what an agent would get from a directory, and a README kept for people is not part of that;
  - a template for the row: one shape that every pack's readers know is worth more than a language for shapes;
  - writing the file without the comments, at a heading: a heading is the author's, and the command would have to guess where the list ends.
