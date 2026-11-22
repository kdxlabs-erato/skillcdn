---
"@skillcdn/core": patch
"@skillcdn/indexer": patch
"@skillcdn/reader": patch
"@skillcdn/cli": patch
---

A `SKILLCDN.md` can name the page an agent reads first (ADR-0119): `start: docs/finding-a-skill.md`, the path of a Markdown document relative to the manifest. A client is told on connect `Start here, before a task: read_repo_file <path>.`, in the place of the line that names the README, by every mount that can read the page. The page is served as a document wherever it stands. A path that names no Markdown document of the repository, or one that is excluded, is the index diagnostic `start_missing`, which `skillcdn check` fails on; `check` prints the field with the manifest.

The REST API answers the page as `start` in the manifest of a mount. The reading rules are at version 21. In `@skillcdn/core`, `RepoManifest`, `MountManifest` and `CatalogManifest` carry `start`.
