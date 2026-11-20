---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

The instructions of a connection keep a line for every folder while its path fits. Before, the folder lines were written whole until one did not fit in the 2,000 characters, and that folder and every one after it were left out without a word. Now the descriptions are cut to one length for all the folders, then left out, then the names, so that a pack that grows loses words before it loses folders; where the paths and counts alone do not fit, a line says how many folders are not listed. A pack whose lines fit is told as before.

`skillcdn check` says beside the length of the instructions when the folder lines say less or some are left out. `@skillcdn/core` exports `fitInstructions`, which answers the text with what became of the rows, `catalogGroups` and `holdsSomething`; a catalog may carry `groupCount`, and the `mounts` answer of the REST API carries it as `index.groupCount`.
