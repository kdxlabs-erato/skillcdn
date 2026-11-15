# ADR-0104: The words of a search across the packs are counted and matched in a copy of the entries it searches

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0090](0090-a-search-across-the-packs-reads-what-is-searchable-and-an-index-of-a-table-in-use-is-built-without-holding-its-writes.md) (the counts are exact), [ADR-0098](0098-the-words-of-a-search-across-the-packs-are-narrowed-as-they-are-read-and-a-vector-is-unpacked-once.md) (the read of the index of the vectors stands alone and is narrowed as it is read; it left a search reading the row of every entry that holds a word, in whatever commit), [ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md) (the commit a default branch is served from) and [ADR-0086](0086-an-index-is-kept-while-a-ref-points-at-its-commit-or-it-was-read-lately.md) (the commits kept beside it). Replaces, in point 2 of ADR-0090 and point 1 of ADR-0098, where a word is looked up for the snapshots that are copied: in the index of the copy's vectors.

## Context

The first search across the packs after a deployment had been idle for hours ran its count of the words past the default limit of a statement, two seconds. With the meaning out of its time as well, it was answered `search.timeout`; with the meaning in time (ADR-0103), it was answered by meaning alone.

Measured on the test database of ADR-0103 (700 packs, 20,592 findable entries in the commits served and fourteen times as many in the commits kept beside them), with nothing in memory, the count took 1.9 seconds, 1.6 of them reading: 17,871 pages of the entries' rows. The index of the search vectors holds every commit a deployment keeps, and a word looked up in it reads the row of every entry that holds the word to learn its snapshot. 93 in a hundred of the rows read were of commits no search covers. The match read the same rows, and then the vectors of the entries it kept. The cost grew with every commit kept, in memory as well as out of it.

Three ways of having an index know the snapshot were measured and dropped.

- **The snapshots beside the word**, for the planner to combine the index of the findable entries with that of the vectors: it never chose to, even with every other way of reading turned off.
- **One index of the snapshot and the vector together** (`btree_gin`): the planner used it for the word alone.
- **The snapshot written into the vector as a word of its own**, an index of an expression: the pages read fell from 19,104 to 1,741, and testing each row for one of 700 snapshots took a second and a half of the processor, more with every pack.

## Decision

1. **The findable entries of the snapshots the search covers are copied, each with its search vector.** `hub_entries` holds the snapshot, the path and the vector, under an index of its own over the vectors. `hub_snapshots` says which snapshots are copied, as of the instant their index was written (`indexed_at`), and how many entries each holds. A snapshot's row there and its entries are written in one transaction and dropped together.
2. **A snapshot is copied in the transaction that writes its index, where the search covers it then**, as it covers the newest commit of a default branch. An index written again drops the copy of the one before first.
3. **A pass of the worker, every minute, follows the rest.** It drops the copies of the snapshots the search no longer covers, and of those indexed since they were copied. It copies the snapshots covered without a copy: a default branch that moved back to a commit indexed before, a repository public again, an index written by a build before this one, and, on the day a deployment is given the tables, everything.
4. **The count and the match read the copy for the snapshots copied as their index is now, and the entries for the rest, as before.** Both run in one transaction that sees the copy as it was at its start. Which snapshots are copied is read from `hub_snapshots` against each snapshot's `indexed_at`, so a copy is never read for an index other than the one it was made of, whoever wrote that one.
5. **The answer is the same from either.** The counts are exact. The total of a copied snapshot is the number its row holds, and the columns of an entry are read for the entries answered alone.
6. **The index of the copy's vectors keeps no list of pending entries** (`fastupdate` off). It is written a snapshot at a time and read by every search, which would otherwise read the list through.
7. **A deployment that does not search across its packs (`HUB_SEARCH=false`) keeps no copy.** Its writes copy nothing, and its worker's pass drops what was copied before.

## Consequences

| On the database above | Before | After |
|---|---|---|
| The count, nothing in memory | 1.9 s | 53 to 57 ms |
| The match, nothing in memory | 1.2 s | 1.02 to 1.03 s |
| The count, in memory | 458 ms | 14 to 18 ms |
| The match, in memory | 233 ms | 129 to 137 ms |

- **What the match reads now is the vectors of the entries it ranks.** For a question of ten common words, those are the 12,630 entries that hold one, 117 megabytes, which the rank of each reads whole.
- **The comparison by meaning no longer finds the rows of the findable entries in memory**, since the words read the copy. With nothing in memory it takes what it takes when asked alone (ADR-0103), 1.3 seconds there.
- **The copy takes storage that follows what is searched**, not what is kept beside it: on the database above 153 megabytes for the 20,592 entries, 1.3 times what their vectors take in the entries.
- **An index the search covers is written with its copy**, which takes as long as copying its findable entries: on the database above the first pass copied 700 snapshots in 50 seconds, and a pass with nothing to do runs two queries in a few milliseconds.
- **A snapshot not copied yet is read as before**, at what that costs, until the next pass, and nothing is missed or counted twice meanwhile. Such a snapshot is read from the entries of every commit, so one of them costs a search what all of them did.
- **The copy is not tenant-scoped.** It holds snapshots of repositories that were public when copied, and is read only by the search across packs, which names the snapshots it searches. A repository gone private is out of the search at once, and its copy goes at the next pass.
- **Rejected:**
  - a flag on the entries: an entry is immutable, and whether its snapshot is searched changes without it;
  - the counts kept and refreshed in the background: they would no longer be exact (ADR-0090, point 2);
  - the count left as it was, the meaning answering alone where it ran out: the reads grow with every commit kept, in memory too, and the match is no faster;
  - the columns of an entry in the copy: a second copy of what the reads of the answered rows give.
