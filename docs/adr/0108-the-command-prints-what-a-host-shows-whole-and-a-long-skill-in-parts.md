# ADR-0108: The command prints what a host shows whole, and a long skill in parts

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md) (the command reads a pack as a deployment serves it).

## Context

`skillcdn skill` joined every page of a skill's context and printed the skill whole. `skillcdn file` printed a page of 40,000 characters unless told otherwise. An agent runs these through the host that runs its commands, and hosts bound what they show of one command's output. One of them saves an output of more than 30,000 characters to a file and shows the agent the first two kilobytes. Others cut a long output in the middle. A skill that includes several files easily passes that: a skill of the reference pack printed 59,000 characters. An agent that saw only the start could begin with the description and none of the workflow, and nothing in what it saw told it so.

## Decision

1. **A read prints at most 28,000 characters for an agent** (`OUTPUT_CHARS`). That is below the least bound of the hosts measured, with room for the line that ends a part.
2. **A skill longer than that is printed in parts.** A part joins as many pages of the skill's context as fit, and at least one. It says at its head that the skill's context is incomplete, as a page over MCP does. Its last line is the command that prints the next part: the pack, the path or URI, `--url` and `--as` as they were given, and `--cursor` with the next page's cursor. The line says to read every part before using the skill. A skill that fits is printed whole, as before.
3. **A part is a run of the same pages a client reads over MCP.** The cursor belongs to the index of the commit, so a part asked for after the pack moved is refused as a misuse, as a stale cursor of any read is.
4. **A page of a file is 24,000 characters unless `--limit` says otherwise** (`FILE_PAGE_CHARS`). The command ends it at its last whole line, as the reader ends a page it cuts, and it says where the next begins.
5. **`--json` is the API's.** It prints the skill whole, from `--cursor` where one is given, and the file's page as the REST API answers it, 40,000 characters by default.

## Consequences

- **The skill of 59,000 characters is printed in three parts** of 19,600, 19,500 and 25,300 characters.
- **A part repeats the head of the skill and its list of files**, as each page over MCP does.
- **An agent that reads a long skill makes as many calls as it has parts.**
- **The bound is the command's, not the format's.** MCP pages and the REST API are as they were.
- **Rejected:**
  - printing whole and relying on the host to save the rest: a host that cuts in the middle gives no sign;
  - a setting for the bound: no host is known to need less, and one can be added when one does;
  - offsets into the printed text instead of the pages' cursor: a part read after a push would continue another version of the skill without saying so.
