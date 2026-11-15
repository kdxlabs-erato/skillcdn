---
"@skillcdn/inference": patch
"@skillcdn/cli": patch
---

A query is embedded from its first 128 estimated tokens: some hundred words of English, or 160 characters of Korean. A search waits for its query, and a long one could take a server on one CPU past the five seconds a query has, leaving that search to its words. The words of a search still take the whole query.

- `@skillcdn/inference`: `createEmbeddingsApi` takes `maxQueryTokens`, 128 unless you set it, and never more than `maxTextTokens`.
- `@skillcdn/cli`: the commands that search a directory by meaning read `EMBEDDINGS_QUERY_TOKENS`, with the default a deployment has.
