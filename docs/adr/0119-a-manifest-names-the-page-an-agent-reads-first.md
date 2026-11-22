# ADR-0119: A manifest names the page an agent reads first

- Status: Accepted
- Date: 2026-11-22

## Context

What a client is told on connect names two files to read: the README of the mounted folder, as an optional overview, and the manifest, for the pack's metadata and rules. Neither is what an agent needs first in a pack of many skills, which is how to find the skill for the task at hand.

The reference pack has a page for that, and nowhere to name it. It spent the last sentence of its description on it, some sixty of the 240 characters the instructions quote: "Before a job, find its skill (docs/pack/finding-a-skill.md)." Eleven fresh sessions out of eleven read that page before choosing a skill, so the sentence works, in a place made for something else. The README the instructions point at is 47 KB written for the people who open the repository at the git host.

## Decision

1. **`start` in a manifest names a page.** The value is the path of a Markdown document of the repository, relative to the manifest, written as the path of an `image` is. It is where a pack says how it is used.
2. **A client is told of it in the place of the README.** Where the mount can read a start page, the connection instructions say `Start here, before a task: read_repo_file <path>.` and leave out the line of the optional overview. The line of the manifest stays. A pack without the field is told as before.
3. **The nearest page inside the mount is the one told.** A mount takes the page of the nearest manifest at or above it whose page lies inside the mount. A page outside the mount is not told: its client could not read it.
4. **The page is served because it is named.** It is a document of the index wherever it stands, under a directory of documents or not, as a file a document links to is readable; it is searched like any document.
5. **A page that is not there is a finding.** A path that names no Markdown file of the tree, a `SKILL.md` or a manifest among them, or a file that is excluded or over the limits, is the index diagnostic `start_missing`, which `check` fails on, and nothing is told. A value that is not a path is ignored with a warning, as any field is.
6. **The REST API answers it** as `start` in the manifest of a mount, so that the command prints what a client is told from a deployment as from a directory. The reading rules go to version 21.

## Consequences

- A pack says where its agents begin in one field, and its description is again about what the pack is for.
- The words of the instructions change for a pack that sets the field, and with them what a model does first. That is the point of the field, and the author's to try: `skillcdn skills` prints the instructions.
- The line is one line: the folder lines keep the room they had.
- **Rejected:**
  - a line beside the README's: two files to read first are none, and the room is the folders';
  - taking the page from a link in the manifest's body, or from a file name such as `START.md`: the body is rules that travel with every skill, and a name reserved after the fact turns existing files into instructions;
  - a start page per skill folder told in every listing: a folder has its README for that, which `browse_repo` names;
  - warning without failing: a manifest that promises a page and names none is a broken link in the one place every client reads.
