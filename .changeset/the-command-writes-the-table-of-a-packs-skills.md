---
"@skillcdn/cli": patch
---

`skillcdn catalog [<directory>]` prints the skills of a directory as a Markdown table for the people who read its README (ADR-0121): each skill's name, linked to its `SKILL.md`, and the first sentence of its description, in path order, then how many there are; `--folder <path>` keeps it to one folder.

`--write <file>` writes the table into a file of the directory, between `<!-- skillcdn:catalog -->` and `<!-- /skillcdn:catalog -->`, and leaves the rest of the file alone. A region lists the skills under the folder its file stands in, or under the one its opening comment names (`folder=marketing`); a file may hold several. `--check <file>` writes nothing and exits with `1` when a region is not what `--write` would make it, so that a job holds a README to the pack.
