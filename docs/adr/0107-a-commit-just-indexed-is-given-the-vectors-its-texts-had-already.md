# ADR-0107: A commit just indexed is given the vectors its texts had already

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0093](0093-a-section-whose-text-has-a-vector-is-given-it-and-not-embedded-again.md) (a section whose text has a vector is given it), [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (a ref is served from its newest commit once that is indexed) and [ADR-0072](0072-the-worker-embeds-the-packs-first-and-the-rest-when-asked.md) (which commits are embedded unasked).

## Context

The vectors of a section are kept under the git blob of the body it stands in. An edited file is a new blob, so it has no vectors until the worker embeds the commit, even when nearly every section of it says what it said before. Its commit is served as soon as it is indexed. From then until the worker reached it, the file was found by its words alone: below the files of the same pack that were not edited, and not at all by a question in another language.

The worker gives most of those sections the vectors their texts already have, by hash, without calling the model (ADR-0093). The gap was the time the job waited in the queue behind the slices of other packs. A pack that is edited often was searched by meaning less well for as long as it was being edited.

## Decision

1. **When a commit is indexed, its bodies with nothing embedded are given the vectors their texts have already**, in the process that indexed it and before its job is queued. The sections, and the head of a skill, are cut and hashed as the worker cuts and hashes them, and looked up by hash. No call goes to the embedder.
2. **A body given only some of its vectors is written as unfinished** (`unfinished_bodies`). What is left to embed counts it as not embedded, so the worker still reaches it. The worker embeds the sections that have no vector, gives the others theirs again, and drops the row in the transaction that writes the body to the end.
3. **The parts of a body are made from what it has**, as they are for any write, and made again when the rest arrives. A search, of one pack or across the packs, finds the file by the meaning of the sections it has.
4. **It is done only where the worker will embed the commit unasked**, under the same scope, entitlements and rank, and only when at most 200 bodies are left to embed. A larger number is a new pack, or a change of most of one, where there is little to find and the worker finds it as it goes.

## Consequences

- **A file edited in one place keeps its meaning across a push.** Only the sections that changed wait for the worker.
- **A change that touches the text of every section has nothing to be given**, and waits as before. Examples are a new title, which every section's text begins with, or a new description of a skill.
- **Indexing a changed commit costs one read of each changed body and one lookup of its hashes**, in the process that indexes it.
- **The progress of an embedding counts an unfinished body as not embedded**, as the worker does.
- **Rejected:**
  - searching the previous commit until the new one is embedded: every statement of the search by meaning would read two snapshots for one, and the passages it answered would be the old file's;
  - putting the job of a changed commit ahead in the queue: it shortens the gap to the slice running then, a few minutes, and leaves it;
  - counting the sections a body should have instead of a row for an unfinished one: the count is the indexer's, not the database's, and a body with any vector has counted as done since the vectors were first kept.
