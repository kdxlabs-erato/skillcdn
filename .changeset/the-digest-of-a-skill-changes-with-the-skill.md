---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
"@skillcdn/reader": minor
---

Breaking: the `SKILL.md` a skill is served as names no commit, so its digest changes when the skill changes and through no other push (ADR-0117). The first line reads `> Assembled by SkillCDN from <paths>.`, and a file left out for its size is named by the address of its git object, with the header to send where the host needs one (`Accept: application/vnd.github.raw+json` at GitHub), instead of its raw address in the commit served. `load_skill` and the REST skill route still name such a file in the commit they read. A host that verified a skill is asked once more, when the commit is reindexed, and then only when the skill changes.

The reading rules are at version 20, so every index is rebuilt; an index of an older version is served as it was digested until then. In `@skillcdn/core`, `provenanceLine` takes the sources first and the commit only for such an older index, `SkillDocumentInput.commit` and `SkillDocumentSources.commit` are optional for the same reason, an `OmittedFile` may carry `accept`, and `blobFileUrl` and `COMMITLESS_DOCUMENT_INDEX_VERSION` are new.
