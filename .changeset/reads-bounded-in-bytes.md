---
"@skillcdn/core": patch
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

What one read of the command prints for an agent is bounded in bytes, as the hosts that run its commands count, and a part of a skill says what a page over MCP says ([ADR-0124](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0124-what-reaches-an-agent-is-bounded-in-bytes-on-either-route-and-a-part-says-what-a-page-says.md)).

- **Every read of the command keeps within 28,000 bytes** (`COMMAND_OUTPUT_MAX_BYTES` of `@skillcdn/core`), where a skill was bounded at 28,000 characters and the other reads not at all. Text of three bytes a character passed both hosts measured: a skill in Hangul was printed in parts of some 49,000 bytes, which one host saved to a file and the other cut in the middle; it is now printed in parts of at most 17,600. A page of a file is ended after the last line that fits, a page of a folder, an outline or a search holds no more entries than fit, and `skillcdn skills` prints a long listing in pages, each ending with the command that lists the rest (`--cursor`).
- **A part of a skill says how many pages of the skill follow it**, at its head with the command that prints the next part and again at its end, where it says not to use the skill, plan from it or answer from it yet and to read the next part now; its last line is that command, alone. The last part says `Skill context is complete: this was its last part.` Against a deployment that counts no pages a part says the same without the count.
- **The command's first part shows a skill's lists as a first page over MCP does**: its files up to 3 KiB of paths, five references resolved, a long description, metadata or warnings shortened, with a line that names what was.
- **`readPack` answers where a read goes on** (`next`: the `cursor` of the next part or page, with `pagesLeft` for a skill, or the `offset` of a file), so that a program built on it reads no text for it, and prints the sentences of a part in the caller's words, with the line its `nextPart` makes. A listing is printed in pages only for a caller that gives `nextPart`, and whole otherwise, as before. A caller that prints lines of its own beside the text says how many bytes they take (`room`), and the read keeps them free.
- `@skillcdn/core` adds `COMMAND_OUTPUT_MAX_BYTES`, `fitsCommandOutput`, `utf8Length`, and `skillShown` and `fileShown`, what one answer shows of a page of a skill or of a file, which the MCP replies of `@skillcdn/serve` and the command now share; `ToolWords` takes `loadNext`, the line that reads on. `OUTPUT_CHARS` of `@skillcdn/cli` is deprecated, and is the same number.

The MCP text, the pages, the cursors and the reading rules do not change.
