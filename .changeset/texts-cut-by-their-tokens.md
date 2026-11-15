---
"@skillcdn/core": patch
"@skillcdn/inference": patch
"@skillcdn/cli": patch
---

A text is embedded within the tokens it is estimated to be, not only within its characters. The same eight thousand characters are some 1,600 tokens of English and over 7,000 of Hindi or of a list of hashes, and a server embeds a text more slowly the more tokens it has.

- `@skillcdn/core`: `estimatedTokens` and `cutToTokens` estimate the tokens of a text for an embedding model, at or above what one tokenizer counts for every script measured. The `Embedder` port takes `maxTextTokens`.
- `@skillcdn/inference`: `createEmbeddingsApi` cuts every text to `maxTextTokens` estimated tokens after its characters, 4,096 unless you set it. English and Russian sections of the default eight thousand characters are cut as before. A call whose time ran out is an `InferenceError` with `timedOut` set, and `isInferenceTimeout` tells it apart from a server that could not be reached; its code stays `inference_unreachable`. `cutText` takes the tokens as a third argument.
- `@skillcdn/cli`: `skillcdn serve`, `mcp` and `embed` read `EMBEDDINGS_TEXT_TOKENS`, with the default a deployment has.
