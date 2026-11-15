# ADR-0106: The build of an index gives the process back as it reads

- Status: Accepted
- Date: 2026-11-15
- Builds on [ADR-0007](0007-snapshot-rows-coordinate-indexing.md) (a commit is indexed by the process that claims it, an `api` among them).

## Context

An `api` indexes a commit that a request asks for and nobody has indexed. The build fetches the bodies, then reads every one of them: it parses it, takes its links and headings, and makes its search vector. Once the bodies are in hand, from the archive or the blob store, the awaits between those reads resolve without waiting on anything. The reading of every document of the commit then runs as one turn of the event loop, and the process answers no other request until it ends.

Measured on a developer's machine with a public repository of 3,244 files, 1,679 of them documents read for search: the build took 5.0 seconds, and a timer due every 25 milliseconds waited 4.3 seconds of them. A slower processor holds it longer. Anyone can start that with one request for the address of a large public repository. A longer stall would fail the checks a load balancer makes of the process.

## Decision

1. **The build gives the process back every 64 KiB of text it reads** (`TEXT_PER_TURN`). The count covers the manifests and skills, the documents served, the documents reached by links, the documents made from other documents, and the entries whose links name sections. The build checks its signal after each pause.
2. **The pause is the next turn of the event loop** (`setImmediate`), unless the caller passes its own (`pause`). A test passes one that counts.
3. **The index does not change**: the same entries, the same diagnostics. `INDEX_VERSION` stays where it is.

## Consequences

- **In the measurement above, the longest wait of the timer fell from 4.3 seconds to 0.14**, and the build still took 5.0 seconds.
- **The worker builds indexes with the same code**, so its lease renewal and its queue's heartbeat run during a build as well.
- **`skillcdn check` and the command's reads pause the same way.** It costs them nothing they would notice.
- **Rejected:**
  - a thread of its own for the build: the git host, the blob store and every body would have to cross into it, and the bodies would be held twice;
  - indexing only in the worker: `INDEX_CONCURRENCY=0` already does that for a deployment that wants it, and the first request for a pack would wait on the queue;
  - a pause after every document: a repository of many small files would pay a turn for each.
