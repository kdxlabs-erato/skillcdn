# ADR-0117: The document a skill is served as names no commit, and names a file left out of it by what the file holds

- Status: Accepted
- Date: 2026-11-22
- Amends point 1 of [ADR-0025](0025-a-skill-on-the-wire-is-assembled-from-its-sources.md) (the line that names the sources no longer names the commit) and point 2 of [ADR-0033](0033-a-file-over-the-read-limit-is-named-with-its-source.md) (a file left out is named by the address of its content, not of the commit served). The digest over the assembled document, and the rest of both, stay as decided.

## Context

A host that implements the skills extension verifies a skill by the digests of its files and asks its user once per content ([ADR-0024](0024-skills-travel-through-the-mcp-skills-extension.md)). That decision rejected a URI that carries the commit, because a host that keys identity on the URI would see a new skill at every push.

The same happened through the document. Its first line named the commit it was assembled from, and the line of a file left out for its size carried the file's address in that commit. The digest is computed over those bytes, so every push changed the digest of every skill of the repository, whatever the push touched: between two commits of the reference pack that changed a README, the working agreement and CI, all twenty skills on the first page of the listing had a new digest. A pack that pushes several times a day made a verifying host ask again for each of its skills each time.

The commit is said elsewhere already: by the listing, by the `Source` line of every tool result and by the connection instructions.

## Decision

1. **The document names its sources and no commit.** The line reads `> Assembled by SkillCDN from <paths>.` The same sources are the same bytes in every commit, so the digest of a skill changes when its own `SKILL.md`, a file it includes, a manifest above it or a file it is served without changes, and through no other push.
2. **A file left out for its size is named by what it holds.** Its line carries the address of the file's git object at the host, which no commit moves, and the media type to ask that address for where the host answers the bytes only when asked: at GitHub `https://api.github.com/repos/<owner>/<repo>/git/blobs/<hash>`, with the header `Accept: application/vnd.github.raw+json`. A pack read from a directory names the file itself, as before. The line changes when the file does, and the digest with it.
3. **A tool and the REST API name the same file in the commit read.** `load_skill` and the skill route list a left-out file with its raw address in the commit they answered from, which a plain request fetches. Their results are not digested, and already name that commit.
4. **An index of the older rules is served as it was digested.** The reading rules go to version 20. While a commit is rebuilt, the index written under an older version answers ([ADR-0068](0068-a-mount-serves-the-last-indexed-commit-while-the-newest-is-not-ready.md)), and the reader assembles its document with the commit in the line, as that index digested it: what a host reads is what its listing declared, under either version.

## Consequences

- A host that verified a skill is asked once more, when the commit is rebuilt under version 20, and from then on only when the skill changes.
- The document alone no longer says which commit it came from. Its digest says which content it is: the listing of any commit names the digest of each skill, so a copy is matched to a commit by hashing it.
- The address of a left-out file needs a header at GitHub and counts against the rate limit of its API, where the raw address did neither. It is exact for every ref, which a raw address by a branch name would not be.
- **Rejected:**
  - writing the git object hash of every source into the line: the provenance would be exact, but a model would read a line of hashes at the top of every skill, and the digest already identifies the content;
  - the raw address at the default branch for a left-out file: stable, but a mount at a tag or at another branch would be sent to the file of the default branch, without a word;
  - keeping the commit and digesting something other than the bytes served: a host hashes what it reads.
