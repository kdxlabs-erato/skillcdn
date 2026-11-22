---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
"@skillcdn/cli": patch
---

A link whose destination is a skill URI names a file of another pack (ADR-0120): `[the base skill](skill://gh/acme/skills/design/card/SKILL.md)`, in a skill, in a manifest's rules or in any served Markdown document. The index keeps the link with the file that holds it and looks into no other repository. The first page of `load_skill` and a page of `read_repo_file` list what they link to in other packs, under `In other packs, not readable here:`, with how each is read at its pack; the REST API answers `packReferences` on a skill and on a file page. A destination under the scheme that is no skill URI, one with a ref or without a path, is the index diagnostic `pack_link_invalid`.

`skillcdn check` lists the files of other packs a directory links to, and `skillcdn check --references [--url <origin>]` reads each once at a deployment: a file its pack does not have fails the check, and one that could not be asked about is `not known`. The reading rules are at version 22.

In `@skillcdn/core`, `inspectMarkdownLinks` answers `packs`, and `PackLink`, `PackReference`, `restPackReferenceSchema` and `MAX_PACK_LINKS` are new; in `@skillcdn/indexer`, `checkDirectory` takes `verifyPackReferences`.
