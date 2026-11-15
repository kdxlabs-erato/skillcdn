---
"@skillcdn/indexer": patch
---

`buildSnapshotIndex` gives the process back every 64 KiB of text it reads, so that a server indexing a large commit in the process that answers its requests goes on answering them. Once the bodies were in hand, the reading of every document ran as one turn of the event loop: on a repository of 1,679 documents read for search, 4.3 seconds of a 5-second build, and 0.14 seconds now. The index is the same. `pause` in the options replaces the next turn of the event loop with a function of your own.
