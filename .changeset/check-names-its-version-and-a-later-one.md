---
"@skillcdn/indexer": patch
"@skillcdn/cli": patch
---

`skillcdn check` names its own version in the first line of the report, beside the version of the reading rules: `(skillcdn 0.6.0, reading rules version 20)`. When the npm registry has a later release of the command, a line on standard error says so and how to run it. A command that `npx` took from its cache read a pack by older rules and said nothing of it.

The request to the registry is the only one `check` makes. It waits at most a second and a half, changes neither the report nor the exit code, and is left out with `--offline` or `SKILLCDN_OFFLINE=1`. The documented commands are now `npx @skillcdn/cli@latest check`.

In `@skillcdn/indexer`, `checkDirectory` takes `command`, what ran it, for that first line.
