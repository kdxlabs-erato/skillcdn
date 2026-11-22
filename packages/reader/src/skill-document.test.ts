import { createHash } from "node:crypto";
import {
  type IndexEntry,
  type IndexLimits,
  NO_LICENSE,
  parseAddress,
  type RepoPath,
  type SnapshotIndex,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createMemoryIndex } from "./memory-index.js";
import type { MountContext } from "./mount.js";
import { Reader } from "./reader.js";

// The document a skill is served as names no commit (ADR-0117). An index written while it did
// digested the line with the commit, and is read so until it is rebuilt: what a host reads is
// what the listing digested, under either version of the reading rules.

const COMMIT = "c".repeat(40);
const SKILL = "---\nname: write\ndescription: Writes.\n---\nWrite it.\n";
const URI = "skill://gh/acme/skills/skills/write/SKILL.md";
const BLOB_URL = `https://api.github.com/repos/acme/skills/git/blobs/${"f".repeat(40)}`;
const OMITTED = {
  path: "skills/write/data/fonts.json",
  size: 5_000_000,
  sourceUrl: BLOB_URL,
  accept: "application/vnd.github.raw+json",
};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const documentWith = (line: string): string =>
  `---\nname: "write"\ndescription: "Writes."\n---\n${line}\n` +
  `> Not included, over this server's file size limit: \`${OMITTED.path}\` (${OMITTED.size} bytes); fetch it from ${BLOB_URL} with the header \`Accept: ${OMITTED.accept}\`\n\n` +
  "--- instructions ---\nWrite it.\n";

function indexOf(version: number, document: string): SnapshotIndex {
  const skill: IndexEntry = {
    kind: "skill",
    path: "skills/write/SKILL.md",
    size: SKILL.length,
    blobSha: "s",
    skillDir: "skills/write",
    name: "write",
    title: undefined,
    description: "Writes.",
    frontMatter: { metadata: {}, warnings: [], omitted: [OMITTED] },
    searchable: true,
    visible: true,
    listed: true,
    digest: sha256(document),
    servedSize: document.length,
  };
  return {
    entries: [skill],
    truncated: false,
    indexedBytes: 0,
    diagnostics: [],
    license: NO_LICENSE,
    version,
  };
}

const LIMITS: IndexLimits = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 1000,
  maxIndexedFileBytes: 1_000_000,
  maxIndexedTotalBytes: 10_000_000,
  maxReadableFileBytes: 1_000_000,
  maxArchiveBytes: 100_000_000,
};

function mountOf(): MountContext {
  const parsed = parseAddress("/gh/acme/skills");
  if (!parsed.ok) throw new Error("bad address");
  return {
    address: parsed.value,
    commit: COMMIT,
    verified: true,
    visibility: "public",
    limits: {},
    repository: "acme/skills",
    description: undefined,
    sourceUrl: (path: RepoPath) => `https://host.example/blob/${COMMIT}/${path}`,
    rawUrl: (path: RepoPath) => `https://host.example/raw/${COMMIT}/${path}`,
  };
}

function readerOf(index: SnapshotIndex): Reader<MountContext> {
  const blobs = {
    read: async (hash: string) => (hash === "s" ? SKILL : undefined),
    readBytes: async (hash: string) => (hash === "s" ? new TextEncoder().encode(SKILL) : undefined),
  };
  const memory = createMemoryIndex({ index, blobs });
  return new Reader<MountContext>({
    limits: LIMITS,
    index: async () => ({ status: "ready", index: memory }),
  });
}

async function served(index: SnapshotIndex): Promise<{ text: string; digest: string }> {
  const read = await readerOf(index).readResource(mountOf(), URI, 0);
  if (read.status !== "ready" || read.resource === undefined || read.resource.text === undefined) {
    throw new Error("the skill must be served");
  }
  return { text: read.resource.text, digest: read.resource.digest };
}

describe("the document a skill is served as", () => {
  it("names no commit, so that the same skill is the same bytes in every commit", async () => {
    const document = documentWith("> Assembled by SkillCDN from `skills/write/SKILL.md`.");
    const { text, digest } = await served(indexOf(20, document));
    expect(text).toBe(document);
    expect(digest).toBe(`sha256:${sha256(text)}`);
    expect(text).not.toContain(COMMIT);
  });

  it("is read from an index of the older rules as that index digested it, with the commit", async () => {
    const document = documentWith(
      `> Assembled by SkillCDN from \`skills/write/SKILL.md\` at commit \`${COMMIT}\`.`,
    );
    const { text, digest } = await served(indexOf(19, document));
    expect(text).toBe(document);
    expect(digest).toBe(`sha256:${sha256(text)}`);
  });

  it("names a file left out of a skill in the commit read, where a tool sends its reader", async () => {
    const reader = readerOf(
      indexOf(20, documentWith("> Assembled by SkillCDN from `skills/write/SKILL.md`.")),
    );
    const loaded = await reader.skill(mountOf(), "skills/write/SKILL.md", 0);
    if (loaded.status !== "ready" || loaded.lookup.kind !== "found") {
      throw new Error("the skill must load");
    }
    expect(loaded.lookup.skill.oversized).toEqual([
      {
        path: OMITTED.path,
        size: OMITTED.size,
        sourceUrl: `https://host.example/raw/${COMMIT}/${OMITTED.path}`,
      },
    ]);
  });
});
