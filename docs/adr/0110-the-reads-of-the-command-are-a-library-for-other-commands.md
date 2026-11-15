# ADR-0110: The reads of the command are a library for other commands

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0055](0055-the-command-reads-a-pack-as-a-deployment-serves-it.md) (the command reads a pack as a deployment serves it), [ADR-0056](0056-the-rest-api-has-a-client-and-the-command-reads-a-deployment-through-it.md) (it reads a deployment through the client) and [ADR-0108](0108-the-command-prints-what-a-host-shows-whole-and-a-long-skill-in-parts.md) (what it prints for an agent). Concerns [ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md) (the console is built on the published packages).

## Context

The reference console has commands of its own that read a pack: its skills, a folder, a search, a skill, a file, the tables and code blocks of a document. It renders them with the functions of `@skillcdn/core`, but the layer between the pack and the printed text was the command's alone and private. That layer covers which reads are joined page after page and which are printed a page at a time, the words of a skill that is not there, the line over a code block, the rows as JSON, the line that says what was written, and the words for a number out of range. The console copied it piece by piece. A comparison of seventeen reads on one pack found its file, folder and skill reads printing other text than the command's, and the copies drifted every time the command changed.

## Decision

1. **`@skillcdn/cli` has a library entry point beside its command.** `readPack(pack, read, options)` does one read as the command does, and answers its text: the words an agent is given, in the words the caller gives for the reads (`words`), or the REST API's JSON. The command calls the same function.
2. **A long skill ends its part with a line the caller makes** (`nextPart`), the command that reads the next part in the caller's own terms (ADR-0108).
3. **What goes wrong is thrown, for the caller to say.** `PackError` carries the API's status and code, and `ReadMisuse` is a read not asked right. Printing, files and exit codes are the caller's. A data read answers what its text holds, and `wroteLine` says it was written.
4. **The pack of a deployment comes from `openDeployment`**, over `@skillcdn/client`. The entry point imports neither the reader, the indexer, the inference adapters nor the server: a program that reads deployments carries the client and the core.
5. **The command's own words, bounds and help stay with the command.** Only what every command that reads a pack would print the same is in the library.

## Consequences

- **The console can print what the command prints by handing in its pack and its words**, and a change of the command's text reaches it with the next version.
- **What `readPack` prints is a public surface** of a published package, held to its changesets: a change of the text is a change for every caller.
- **The package declares `exports`.** A program that imported files under its `dist` directory now imports from the entry point.
- **Rejected:**
  - the layer in `core`: it pages through a pack, which is an input and output of its own, and its words for a flag are a command line's;
  - the layer in `@skillcdn/client`: the client answers the API, and the same reads print a directory on the machine.
