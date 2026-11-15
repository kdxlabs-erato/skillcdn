# ADR-0111: The working agreement is AGENTS.md, and a workspace's rules are in its README

- Status: Accepted
- Date: 2026-11-15
- Amends [ADR-0002](0002-toolchain.md) and [ADR-0046](0046-packages-are-published-to-npm-through-trusted-publishing.md) where they name `CLAUDE.md` as the file of the rules. Concerns [ADR-0047](0047-the-console-is-a-separate-repository-built-on-the-published-packages.md) (the reference console beside this repository).

## Context

The working agreement was `CLAUDE.md`, and `AGENTS.md` only pointed at it. Twelve workspaces had a `CLAUDE.md` of their own with the rules of their subtree. Claude Code reads a `CLAUDE.md` when it opens a file beside one. Codex and most other agents read `AGENTS.md` at the root and none of the `CLAUDE.md` files, so they were first handed a pointer that they had to follow.

The two reference repositories now lay out a repository one way. The reference console does it in its own repository. The skills of the reference pack that set a repository up, and the desks the console writes, do it in every repository they make. In that layout:

- `AGENTS.md` is the agreement;
- `CLAUDE.md` imports it and holds nothing else;
- a workspace keeps its rules in its `README.md`.

This repository was the one laid out the other way round.

## Decision

1. **`AGENTS.md` is the working agreement**, the one file a rule of the whole repository is written in.
2. **`CLAUDE.md` imports it** (`@AGENTS.md`) and holds nothing else, so that Claude Code reads the agreement as its own.
3. **A workspace's rules are the "Rules" section of its `README.md`**, and what was learned there the hard way is its "Gotchas". `deploy/README.md` holds the rules of `deploy/` and `.github/`. The README of a published package carries its rules too, written for whoever changes the package.
4. **`.claude/rules/workspaces.md` points Claude Code at those sections** when it opens a file of a workspace, since no `CLAUDE.md` stands beside the file any more. It holds no rule of its own.
5. **The workflow's binding sentence is the one `console use` prints**, copied as it is.

## Consequences

- **Every agent reads the same agreement at the root**, whatever file name its product looks for, and a rule is written in one place.
- **A workspace's rules are read with its README**: on the git host, on the registry for a published package, and in the documentation pack for `deploy/` and `packages/cli/`. An agent other than Claude Code is not handed them when it opens a file there. The agreement says to read them before editing there.
- **A pushed migration is never edited.** So the comments of the migrations that name `packages/db/CLAUDE.md` mean the Rules of `packages/db/README.md` now. The accepted ADRs that name `CLAUDE.md` mean `AGENTS.md`.
- **Rejected:**
  - Keeping `CLAUDE.md` as the agreement: every other agent would still begin at a pointer.
  - An `AGENTS.md` in every workspace, with a `CLAUDE.md` beside it that imports it: two more files in each workspace for what one section of its README holds. The layout the console and the pack's repositories share keeps those rules in the README.
