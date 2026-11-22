import {
  type IndexEntry,
  type IndexLimits,
  NO_LICENSE,
  parseAddress,
  type SnapshotIndex,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createMemoryIndex } from "./memory-index.js";
import type { MountContext } from "./mount.js";
import { Reader } from "./reader.js";

// The page a manifest tells an agent to read first (ADR-0119) is told to the client of a mount
// that can read it: the nearest one a manifest at or above the mount names, inside the mount.

const entry = (patch: Partial<IndexEntry> & Pick<IndexEntry, "path" | "blobSha">): IndexEntry => ({
  kind: "markdown",
  size: 10,
  skillDir: undefined,
  name: undefined,
  title: undefined,
  description: undefined,
  frontMatter: undefined,
  searchable: true,
  visible: true,
  ...patch,
});

const manifest = (path: string, start: string | undefined): IndexEntry =>
  entry({
    path,
    blobSha: "m",
    kind: "manifest",
    searchable: false,
    description: "A pack.",
    frontMatter: { metadata: {}, warnings: [], ...(start === undefined ? {} : { start }) },
  });

const index: SnapshotIndex = {
  entries: [
    manifest("SKILLCDN.md", "docs/start.md"),
    entry({ path: "docs/start.md", blobSha: "d", title: "Start" }),
    manifest("team/SKILLCDN.md", "team/docs/begin.md"),
    entry({ path: "team/docs/begin.md", blobSha: "d", title: "Begin" }),
    manifest("plain/SKILLCDN.md", undefined),
    entry({ path: "plain/docs/guide.md", blobSha: "d", title: "Guide" }),
    entry({ path: "other/docs/guide.md", blobSha: "d", title: "Guide" }),
  ],
  truncated: false,
  indexedBytes: 0,
  diagnostics: [],
  license: NO_LICENSE,
  version: 21,
};

const BODIES: Readonly<Record<string, string>> = {
  m: "---\ndescription: A pack.\n---\n",
  d: "# A page\n",
};

const LIMITS: IndexLimits = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 1000,
  maxIndexedFileBytes: 1_000_000,
  maxIndexedTotalBytes: 10_000_000,
  maxReadableFileBytes: 1_000_000,
  maxArchiveBytes: 100_000_000,
};

function mountAt(path: string): MountContext {
  const parsed = parseAddress(`/gh/acme/skills${path}`);
  if (!parsed.ok) throw new Error("bad address");
  return {
    address: parsed.value,
    commit: "0".repeat(40),
    verified: true,
    visibility: "public",
    limits: {},
    repository: "acme/skills",
    description: undefined,
    sourceUrl: () => "https://host.example/blob",
    rawUrl: () => "https://host.example/raw",
  };
}

async function startAt(path: string): Promise<string | undefined> {
  const memory = createMemoryIndex({
    index,
    blobs: {
      read: async (hash: string) => BODIES[hash],
      readBytes: async (hash: string) => new TextEncoder().encode(BODIES[hash] ?? ""),
    },
  });
  const reader = new Reader<MountContext>({
    limits: LIMITS,
    index: async () => ({ status: "ready", index: memory }),
  });
  const state = await reader.catalog(mountAt(path));
  if (state.status !== "ready") throw new Error("the index is in memory");
  return state.catalog.manifest?.start;
}

describe("the page a pack starts an agent at", () => {
  it("is the one the manifest of the mount names", async () => {
    expect(await startAt("")).toBe("docs/start.md");
    expect(await startAt("/team")).toBe("team/docs/begin.md");
  });

  it("is a manifest's above the mount where the mount can read it, and none where it cannot", async () => {
    // The root's page lies inside a mount of its folder.
    expect(await startAt("/docs")).toBe("docs/start.md");
    // A folder with a manifest that names none, and one without a manifest, are mounts the
    // root's page lies outside of: their client is not sent to a page it cannot read.
    expect(await startAt("/plain")).toBeUndefined();
    expect(await startAt("/other")).toBeUndefined();
    // Below a manifest that names one, the nearest inside the mount is told.
    expect(await startAt("/team/docs")).toBe("team/docs/begin.md");
  });
});
