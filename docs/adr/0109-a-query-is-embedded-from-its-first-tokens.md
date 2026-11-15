# ADR-0109: A query is embedded from its first tokens

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0105](0105-a-text-is-embedded-within-the-tokens-it-is-estimated-to-be-and-a-call-out-of-time-is-embedded-again-in-shorter-texts.md) (a text is cut to the tokens it is estimated to be) and [ADR-0066](0066-the-inference-adapters-are-a-package-of-their-own.md) (the breaker of the adapters).

## Context

A search waits for its query to be embedded, within `EMBEDDINGS_QUERY_TIMEOUT_MS`, five seconds by default. A query may be 500 characters long. On a server of one CPU, a question of 400 characters of Korean, 290 to 380 tokens, took 4.7 to 6.3 seconds to embed. Such a search was answered by its words alone. The adapter's breaker leaves a server alone for ten seconds after three failures in a row, so a few long questions in a row left every visitor's search to the words for that time.

## Decision

1. **A query is cut to its first 128 estimated tokens before it is embedded** (`EMBEDDINGS_QUERY_TOKENS`, and never more than `EMBEDDINGS_TEXT_TOKENS`). That is some hundred words of English or 160 characters of Korean. A document is cut as before.
2. **The words of a search take the query whole.** Only the meaning is asked of its beginning.
3. **The command takes the same variable with the same default.**

## Consequences

- **Most questions are embedded whole**, and a long one is embedded within its time on the server above, so it no longer trips the breaker.
- **The meaning of the end of a long question is not asked.** A question that names its subject late is found by its words there.
- **Two queries that begin with the same 128 tokens have the same vector**, and are kept apart in the query cache, which is keyed by the query.
- **Rejected:**
  - not counting a query that runs out of time toward the breaker: a server that is away would make every search wait its whole time;
  - a longer time for a query: every search would wait it.
