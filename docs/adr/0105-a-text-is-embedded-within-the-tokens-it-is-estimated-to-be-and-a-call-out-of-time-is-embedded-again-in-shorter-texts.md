# ADR-0105: A text is embedded within the tokens it is estimated to be, and a call out of time is embedded again in shorter texts

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0064](0064-meaning-search-runs-on-pgvector-and-pg-boss-behind-an-embedder-port.md) (a slice that fails is tried again by the queue), [ADR-0066](0066-the-inference-adapters-are-a-package-of-their-own.md) (the adapters cut a text before they send it) and [ADR-0093](0093-a-section-whose-text-has-a-vector-is-given-it-and-not-embedded-again.md) (a vector is found again by the hash of the text as it was cut).

## Context

A text was cut to `EMBEDDINGS_TEXT_CHARS` characters before it was embedded, eight thousand by default. What a server takes to embed a text grows with its tokens, and faster than they do: on a CPU of two cores, some 2,700 tokens took two minutes, 3,600 four and 5,200 eight. The same characters are four times as many tokens in one kind of text as in another. One embedding model's tokenizer counted, per character:

| Text | Tokens per character | Eight thousand characters |
|---|---|---|
| English | 0.20 | 1,620 tokens |
| Russian | 0.32 | 2,520 |
| Japanese, Chinese | 0.59 | 4,740 |
| Korean | 0.67 | 5,360 |
| A table of numbers | 0.82 | 6,560 |
| Lines of hexadecimal hashes | 0.90 | 7,160 |
| Hindi | 0.91 | 7,260 |

A section the server cannot embed in a call's time fails the call. The queue tries the slice again from that body, the call fails again, and the snapshot is never done. A deployment that embeds one call at a time embeds nothing else meanwhile. Any public repository can hold such a section: a long table, a list of hashes. The only remedy left to an operator was fewer characters for every text, English ones included.

## Decision

1. **A text cut to its characters is cut again to the tokens it is estimated to be** (`EMBEDDINGS_TEXT_TOKENS`, default 4,096). `estimatedTokens` and `cutToTokens` in `core` make the estimate. The adapter of the common embeddings API cuts a text so before it sends it, and the vector is found again by the hash of the text as it is cut, so the two cuts are one (ADR-0093).
2. **The estimate follows how the tokenizers of the common models split a text before they merge it.** A run of letters counts by its script, at least one token. Each digit is one token. A run of symbols is about one token per two symbols. Whitespace joins the word or symbol after it, unless it is a run, a line break, or a space before a digit. A letter in a word that also holds digits counts as most of a token. The weights are set so that the estimate comes out at or above the count in the table above, never much higher.
3. **A call whose time runs out is made again one text at a time.** Each text is cut to a quarter of `EMBEDDINGS_TEXT_TOKENS`, and a text shorter than that is sent as it is. The vectors are kept under the hashes of the texts as they would have been embedded, so the body counts as done and the same texts are not sent whole again under the model. The worker logs the file, the number of sections and the tokens they were cut to. If a call of one text alone runs out of time again, it fails as any failure does.
4. **An error of the inference adapters says when a call ran out of its time** (`InferenceError.timedOut`, `isInferenceTimeout`), apart from a server that could not be reached. Its code stays `inference_unreachable`.
5. **The command takes the same variable with the same default**, as it takes the others of a deployment.

## Consequences

- **With the default bound, English and Russian are cut as before.** A section of Japanese or Chinese of eight thousand characters is cut near 5,800 characters, Korean near 5,400, and hexadecimal or Hindi near 4,500. At those lengths the server above takes about five minutes, not eight to sixteen.
- **The estimate is 1.01 to 1.2 times what the tokenizer counted on the samples of the table**, and a fifth above it for English. A model whose tokenizer splits a script more finely reads more than the estimate, and the fallback of point 3 covers that.
- **A section already embedded keeps its vector.** One whose text is cut more now is a new text: it is embedded at its shorter length the next time its file changes.
- **A pack with a section no call can embed in its time is embedded to the end.** It costs one call's time once, and that section's vector is the vector of its beginning.
- **A batch that ran out of time because of its total, with no long text in it, is sent again text by text, with nothing cut.**
- **Rejected:**
  - asking the server for the count: the common API has no such call, and one server's tokenizing endpoint is not the others';
  - leaving out a text that cannot be embedded: its body would never count as done, or would need a record of what was left out, consulted by every count of what is embedded;
  - fewer characters for every text: it would cut English sections that embed quickly;
  - trying the call again whole, which is what failed.
