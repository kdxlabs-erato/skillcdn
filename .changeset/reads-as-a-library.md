---
"@skillcdn/cli": patch
---

`@skillcdn/cli` has a library entry point: the reads of a pack as the command prints them, for a program with commands of its own. `readPack(pack, read, options)` does one read (`skills`, `browse`, `find`, `skill`, `file`, `rows`, `code`) and answers the text, in the words you give it for the reads, or the REST API's JSON. `openDeployment` makes the pack of a deployment through `@skillcdn/client`. `PackError` and `ReadMisuse` say what the pack refused and what was not asked right, for you to print. The entry point imports nothing of the file system and nothing that indexes or serves. The `skillcdn` command prints what it printed before.
