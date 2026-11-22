# ADR-0120: A link to a skill URI names a file of another pack

- Status: Accepted
- Date: 2026-11-22

## Context

A pack had no way to point at a file of another pack. A local link names a file of the same repository, an include takes a page of the same repository ([ADR-0044](0044-a-skill-may-include-a-page-of-a-shared-document-set.md)), and an external URL is no reference at all. Two needs met that wall.

A team that makes things over and over keeps a small pack of its own, whose skills extend skills of a larger pack: the extending skill names the base and writes only what differs. Written in prose, the name of the base breaks without a word when the larger pack renames or moves the skill, which the reference pack has done several times. And a pack that explains how this standard behaves copied the sentences, with their version numbers, because the only way to point at the standard's own documents was their address at the git host; copied sentences age.

The grammar for the pointer exists: a skill URI names a file of a pack by the pack's address and the file's path ([address](../specs/address.md#as-a-skill-uri)), and the command reads one as written. An address serves its own repository and nothing else ([ADR-0039](0039-an-address-serves-only-what-is-the-repositorys-own.md)), and that stays.

## Decision

1. **A link whose destination is a skill URI is a reference to a file of another pack.** `[the base skill](skill://gh/acme/skills/design/card/SKILL.md)`, in a skill, in the rules of a manifest or in any served Markdown document, inline or by a reference definition. The file may be a skill's `SKILL.md` or any file the other pack serves. The URI carries no ref: the link names the file at whatever commit its reader's connection to that pack serves.
2. **The index keeps the link and looks nowhere.** A file's links to other packs are kept with it, the pack as an address without a ref and the path, at most 50 a file. Nothing of the other pack is fetched, included, searched or digested, and its rules travel with its own skills. A destination under the scheme that is no skill URI is the diagnostic `pack_link_invalid`.
3. **A read says what it links to elsewhere, and how that is read.** The first page of `load_skill` lists the files of other packs the skill, its rules and its included files link to, and a page of `read_repo_file` the ones of that page: the pack and the path, and that each is read at its pack, over a connection to it or with `skillcdn skill <pack> <path>` and `skillcdn file <pack> <path>`. The REST API answers them as `packReferences`.
4. **`check` lists them, and asks whether they are there when told to.** The report names every file of another pack the directory links to. With `--references` the command reads each once at a deployment, as a read of the file would: a file its pack does not have fails the check, and one that could not be asked about, a pack that is private to the asker or not indexed in time, is said to be not known and fails nothing.
5. The reading rules go to version 22.

## Consequences

- An extending skill says in its own text what it extends, in a form a program can follow and a check can hold to: a copy of the skill taken without SkillCDN still carries the link.
- A document points at another pack's page instead of copying it, and the copy stops aging.
- A broken reference is found when the author checks with `--references`, not when the index is built: an index that depended on another repository would change without a push to its own.
- A git host's page does not make a link of a destination under a scheme it does not know: people who read the file there see the words of the link and no link. An author who writes for them too adds the address of the page beside it.
- **Rejected:**
  - a field in the front matter of a skill (`uses`): it would name the files without saying what the reader does with them, leave the documents without a way to point, and be stripped from the skill on the wire with the rest of what SkillCDN adds;
  - a ref in the reference: the URI grammar has none, and a pointer pinned to a commit of another pack is a copy by another name;
  - taking the other pack's file into this one, by fetching it when the commit is indexed: the index of a commit would no longer be a function of the commit, and one pack would serve another's content under its own license and rules;
  - a link to the address page at a deployment, `https://<origin>/gh/...`: it names a deployment, and the same pack read from another deployment or from a directory would name the wrong one;
  - binding a directory to two packs in `.skillcdn.json`: the commands take the pack a file is read at, and the URI names it.
