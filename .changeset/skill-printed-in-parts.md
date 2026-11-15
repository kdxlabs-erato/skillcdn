---
"@skillcdn/cli": patch
---

`skillcdn skill` prints a skill of more than 28,000 characters in parts, so that the host running your agent shows each part whole. A host may save a longer output to a file and show only its start, or cut it in the middle. Each part says that the skill's context is incomplete, and ends with the command that prints the next part, with its `--cursor`. Read every part before using the skill. A skill that fits is printed whole as before, and `--json` prints it whole.

`skillcdn file` prints 24,000 characters of a file unless `--limit` says otherwise, ended at the end of a line, and says the offset to read on from. It printed 40,000 before. `--json` prints the page the REST API answers, 40,000 characters as before.
