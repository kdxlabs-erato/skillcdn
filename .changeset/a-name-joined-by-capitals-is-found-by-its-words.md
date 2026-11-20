---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
---

A search in words finds the page a name joined by capitals heads. `BerthAssigned` was one word, so "berth assigned" found nothing of the page with that title. Where a name names something, in the name and title of an entry, the words of its path and the headings of its body, the words it is joined of are now words beside it (`berth`, `assigned`; `XMLReader` gives `xml` and `reader`, `Base64Encode` gives `base64` and `encode`). The body and a query are read as before: a name asked for matches whole.

The reading rules are at version 19 (`INDEX_VERSION`): a deployment rebuilds the index of each commit when it is next asked for and serves the one it has until then; the vectors of the sections are kept. `searchLexemes` takes a third argument, `names`, and a `SearchField` may say `names: true`.
