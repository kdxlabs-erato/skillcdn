import {
  HEAD_SECTION,
  type HostRepository,
  type IndexEntry,
  NO_LICENSE,
  queryLexemes,
  queryWeights,
  SECTIONING_VERSION,
  searchFieldsOf,
  searchVectorOf,
  serializeSearchVector,
} from "@skillcdn/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Database, drizzleOf } from "./client.js";
import {
  claimSnapshot,
  countHubLexemes,
  createBlobStore,
  dropHubEntries,
  ensureSnapshot,
  fillPartVectors,
  isStatementTimeout,
  listSearchablePacks,
  PART_SECTIONS,
  type RepoScope,
  saveCachedRef,
  saveRepository,
  searchHubEntries,
  searchHubSectionVectors,
  supportsSectionVectors,
  syncHubEntries,
  type VectorKey,
  writeSectionVectors,
  writeSnapshotIndex,
} from "./index.js";
import {
  createTestDatabase,
  DEV_DATABASE_URL,
  dropPartVectors,
  dropSectionHalves,
  readHubStatements,
  type TestDatabase,
} from "./testing.js";

// The search across every pack a deployment serves (ADR-0070): which packs it covers, and the
// words and the meaning over all of them at once.

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const T0 = new Date("2026-01-01T00:00:00Z");
const KEY: VectorKey = {
  model: "test-model",
  dimensions: 4,
  sectioningVersion: SECTIONING_VERSION,
};

let nextHostId = 5000;
function hostRepository(name: string, visibility: "public" | "private" = "public"): HostRepository {
  nextHostId += 1;
  return {
    hostRepoId: String(nextHostId),
    name,
    defaultBranch: "main",
    description: undefined,
    visibility,
    owner: { hostAccountId: "9001", login: "Acme", kind: "organization" },
  };
}

function entry(patch: Partial<IndexEntry> & Pick<IndexEntry, "path">): IndexEntry {
  return {
    kind: "markdown",
    size: 10,
    blobSha: `sha-${patch.path}`,
    skillDir: undefined,
    name: undefined,
    title: undefined,
    description: undefined,
    frontMatter: undefined,
    searchable: true,
    visible: true,
    ...patch,
  };
}

/** A repository whose default branch is at `commit`, with that commit indexed when `entries` are given. */
async function repository(
  name: string,
  commit: string,
  entries: IndexEntry[] | undefined,
  bodies: Record<string, string> = {},
  visibility: "public" | "private" = "public",
): Promise<RepoScope> {
  const repo = await saveRepository(
    database,
    { host: "gh", owner: "acme", repo: name },
    hostRepository(name, visibility),
    T0,
  );
  const scope = { accountId: repo.accountId, repoId: repo.id };
  await saveCachedRef(database, scope, "", commit, T0);
  if (entries !== undefined) {
    await index(scope, commit, entries, bodies);
  }
  return scope;
}

/** Indexes `commit`, under the reading rules of `version`: a later one indexes it again. */
async function index(
  scope: RepoScope,
  commit: string,
  entries: IndexEntry[],
  bodies: Record<string, string>,
  {
    version = 1,
    now = T0,
    hub,
  }: { readonly version?: number; readonly now?: Date; readonly hub?: boolean } = {},
): Promise<string> {
  const snapshot = await ensureSnapshot(database, scope, commit, version, now);
  const at = { accountId: scope.accountId, snapshotId: snapshot.id };
  const store = createBlobStore(database);
  for (const [sha, content] of Object.entries(bodies)) {
    await store.write(sha, new TextEncoder().encode(content));
  }
  expect(await claimSnapshot(database, at, "builder", now, 60_000)).toBeDefined();
  const vectorized = entries.map((item) =>
    item.searchable && item.search === undefined
      ? {
          ...item,
          search: serializeSearchVector(searchVectorOf(searchFieldsOf(item, bodies[item.blobSha]))),
        }
      : item,
  );
  expect(
    await writeSnapshotIndex(
      database,
      at,
      "builder",
      {
        entries: vectorized,
        truncated: false,
        indexedBytes: 0,
        diagnostics: [],
        license: NO_LICENSE,
        version,
      },
      now,
      hub === undefined ? {} : { hub },
    ),
  ).toBe(true);
  return snapshot.id;
}

/** The snapshots whose entries are copied for the search across packs, and the paths copied. */
async function copies(): Promise<Map<string, string[]>> {
  const rows = await drizzleOf(database).execute<{ snapshot_id: string; paths: string[] | null }>(
    sql`select h.snapshot_id, array_agg(c.path order by c.path) filter (where c.path is not null) as paths
      from hub_snapshots h left join hub_entries c on c.snapshot_id = h.snapshot_id
      group by h.snapshot_id`,
  );
  return new Map(rows.rows.map((row) => [row.snapshot_id, row.paths ?? []]));
}

const commit = (letter: string) => letter.repeat(40);

describe("the packs a search across every pack covers", () => {
  it("are the public repositories with an index at the commit their default branch is served from", async () => {
    const indexed = await repository("alpha", commit("a"), [
      entry({ path: "docs/alpha.md", blobSha: "hub-alpha", title: "Alpha" }),
    ]);
    await repository("beta", commit("b"), [
      entry({ path: "docs/beta.md", blobSha: "hub-beta", title: "Beta" }),
    ]);
    // Private: not searched, whatever it holds.
    await repository(
      "secret",
      commit("c"),
      [entry({ path: "docs/secret.md", blobSha: "hub-secret", title: "Secret" })],
      {},
      "private",
    );
    // Opted out by its root manifest.
    await repository("quiet", commit("d"), [
      entry({
        path: "SKILLCDN.md",
        blobSha: "hub-quiet-manifest",
        kind: "manifest",
        searchable: false,
        frontMatter: { metadata: {}, warnings: [], search: { meaning: true, hub: false } },
      }),
      entry({ path: "docs/quiet.md", blobSha: "hub-quiet", title: "Quiet" }),
    ]);
    // Never indexed: nothing to search.
    await repository("empty", commit("e"), undefined);
    // Moved on to a commit that has no index yet: served, and searched, at the commit before.
    const moved = await repository("moved", commit("f"), [
      entry({ path: "docs/moved.md", blobSha: "hub-moved", title: "Moved" }),
    ]);
    await saveCachedRef(database, moved, "", commit("0"), new Date(T0.getTime() + 60_000));

    const packs = await listSearchablePacks(database);
    expect(packs.map((pack) => `${pack.owner}/${pack.name}`)).toEqual([
      "Acme/alpha",
      "Acme/beta",
      "Acme/moved",
    ]);
    expect(packs.every((pack) => pack.host === "gh")).toBe(true);
    expect(packs.find((pack) => pack.name === "alpha")?.repoId).toBe(indexed.repoId);
    expect(packs.find((pack) => pack.name === "alpha")?.license).toEqual(NO_LICENSE);
    // What each pack is: a repository read without a manifest, here, holding no skill.
    expect(packs.find((pack) => pack.name === "alpha")).toMatchObject({
      hasManifest: false,
      skillCount: 0,
    });
  });
});

describe("the words and the meaning across every pack", () => {
  it("finds the entries of several packs at once, weighed by rarity across them all", async () => {
    const one = await repository(
      "codes-one",
      commit("1"),
      [entry({ path: "docs/one.md", blobSha: "hub-one" })],
      { "hub-one": "VDS" },
    );
    const two = await repository(
      "codes-two",
      commit("2"),
      [
        entry({ path: "docs/two.md", blobSha: "hub-two" }),
        entry({
          path: "skills/x/SKILL.md",
          blobSha: "hub-x",
          kind: "skill",
          skillDir: "skills/x",
          name: "x",
          description: "VDS forms",
        }),
      ],
      { "hub-two": "4205 standard list", "hub-x": "" },
    );
    const packs = await listSearchablePacks(database);
    const ids = packs
      .filter((pack) => pack.repoId === one.repoId || pack.repoId === two.repoId)
      .map((pack) => pack.snapshotId);
    expect(ids).toHaveLength(2);
    expect(packs.find((pack) => pack.repoId === two.repoId)?.skillCount).toBe(1);

    const lexemes = queryLexemes("VDS 4205");
    const counted = await countHubLexemes(database, ids, lexemes, 5000);
    expect(counted).toEqual({ total: 3, counts: [2, 1] });
    expect(await countHubLexemes(database, [], lexemes, 5000)).toEqual({
      total: 0,
      counts: [0, 0],
    });

    const plain = await searchHubEntries(database, ids, lexemes, undefined, 10, 5000);
    // The skill holds the word in its description, the documents in their bodies; then the
    // shorter document.
    expect(plain.map((row) => row.path)).toEqual([
      "skills/x/SKILL.md",
      "docs/one.md",
      "docs/two.md",
    ]);
    expect(plain.map((row) => row.snapshotId)).toEqual([ids[1], ids[0], ids[1]]);
    const weighed = await searchHubEntries(
      database,
      ids,
      lexemes,
      queryWeights(counted.total, counted.counts),
      10,
      5000,
    );
    // Weighed by rarity, the document that holds the rare code passes the one with the common
    // word, and the skill that holds the common word alone: a skill is ranked as a document is
    // (ADR-0095).
    expect(weighed.map((row) => row.path)).toEqual([
      "docs/two.md",
      "skills/x/SKILL.md",
      "docs/one.md",
    ]);
    expect(await searchHubEntries(database, ids, lexemes, undefined, 1, 5000)).toHaveLength(1);
    expect(await searchHubEntries(database, [], lexemes, undefined, 10, 5000)).toEqual([]);
  });

  it("finds the sections nearest in meaning across the packs, with the entry each belongs to", async () => {
    if (!(await supportsSectionVectors(database))) {
      throw new Error("the test database has no vector extension; the compose file's image has it");
    }
    const near = await repository(
      "meaning-near",
      commit("3"),
      [entry({ path: "docs/near.md", blobSha: "hub-near", title: "Near" })],
      { "hub-near": "# Near\n\nClose by.\n" },
    );
    const far = await repository(
      "meaning-far",
      commit("4"),
      [entry({ path: "docs/far.md", blobSha: "hub-far", title: "Far" })],
      { "hub-far": "# Far\n\nFar away.\n" },
    );
    await writeSectionVectors(database, KEY, [
      {
        blobSha: "hub-near",
        section: 0,
        heading: ["Near"],
        offset: 0,
        length: 20,
        vector: Float32Array.from([1, 0, 0, 0]),
      },
      {
        blobSha: "hub-far",
        section: 0,
        heading: ["Far"],
        offset: 0,
        length: 18,
        vector: Float32Array.from([0, 1, 0, 0]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => pack.repoId === near.repoId || pack.repoId === far.repoId)
      .map((pack) => pack.snapshotId);
    // Through the parts picked first, and with every section compared: the same answer here.
    for (const parts of [10, 0]) {
      const found = await searchHubSectionVectors(
        database,
        ids,
        KEY,
        Float32Array.from([1, 0, 0, 0]),
        10,
        5000,
        parts,
      );
      expect(
        found.map((match) => [match.path, match.title, match.heading, match.similarity]),
      ).toEqual([
        ["docs/near.md", "Near", ["Near"], 1],
        ["docs/far.md", "Far", ["Far"], 0],
      ]);
      expect(found[0]?.snapshotId).toBe(ids.find((id) => id !== found[1]?.snapshotId));
    }
    await expect(
      searchHubSectionVectors(database, ids, KEY, Float32Array.from([1, 0]), 10, 5000, 10),
    ).rejects.toThrow(RangeError);
    // No part made yet, as after an update that brought the parts: every section is compared,
    // where the answer used to be nothing, said to be by meaning.
    expect(await dropPartVectors(database)).toBeGreaterThan(0);
    const unparted = await searchHubSectionVectors(
      database,
      ids,
      KEY,
      Float32Array.from([1, 0, 0, 0]),
      10,
      5000,
      10,
    );
    expect(unparted.map((match) => match.path)).toEqual(["docs/near.md", "docs/far.md"]);
    expect(await fillPartVectors(database, KEY, 100)).toBeGreaterThan(0);
  });

  it("picks the parts nearest the query, and compares the sections of those alone (ADR-0092)", async () => {
    // A long document says one thing in its first sections, another in the next, and what is
    // asked for in its last: the mean of everything it says is near none of them.
    const long = await repository(
      "parts-long",
      commit("7"),
      [entry({ path: "docs/long.md", blobSha: "hub-long", title: "Long" })],
      { "hub-long": "# Long\n\nMany sections.\n" },
    );
    const short = await repository(
      "parts-short",
      commit("8"),
      [entry({ path: "docs/short.md", blobSha: "hub-short", title: "Short" })],
      { "hub-short": "# Short\n\nOne section.\n" },
    );
    // The same bytes in a second pack: one body, an entry in each.
    const copy = await repository(
      "parts-copy",
      commit("9"),
      [entry({ path: "notes/short.md", blobSha: "hub-short", title: "Short" })],
      { "hub-short": "# Short\n\nOne section.\n" },
    );
    const directionOf = (section: number): number[] =>
      section < PART_SECTIONS
        ? [0, 1, 0, 0]
        : section < 2 * PART_SECTIONS
          ? [0, 0, 1, 0]
          : [0, 0, 0, 1];
    await writeSectionVectors(database, KEY, [
      ...Array.from({ length: 2 * PART_SECTIONS + 1 }, (_, section) => ({
        blobSha: "hub-long",
        section,
        heading: [`Section ${section}`],
        offset: section * 10,
        length: 10,
        vector: Float32Array.from(directionOf(section)),
      })),
      {
        blobSha: "hub-short",
        section: 0,
        heading: ["Short"],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0, 0, 0.6, 0.8]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => [long.repoId, short.repoId, copy.repoId].includes(pack.repoId))
      .map((pack) => pack.snapshotId);
    const ask = async (parts: number) =>
      (
        await searchHubSectionVectors(
          database,
          ids,
          KEY,
          Float32Array.from([0, 0, 0, 1]),
          30,
          5000,
          parts,
        )
      ).map((match) => `${match.path} ${match.section}`);
    // One part: the last of the long document, whose one section is what was asked for.
    expect(await ask(1)).toEqual([`docs/long.md ${2 * PART_SECTIONS}`]);
    // Two: the short body as well, once for each pack that holds it, and still nothing of the
    // long document's other parts.
    expect(await ask(2)).toEqual([
      `docs/long.md ${2 * PART_SECTIONS}`,
      "docs/short.md 0",
      "notes/short.md 0",
    ]);
    // With every section compared the long document's other sections follow, as before.
    expect(await ask(0)).toHaveLength(2 * PART_SECTIONS + 3);
  });

  it("compares the sections of the parts it picked at half precision, and at full those not kept so yet (ADR-0103)", async () => {
    const pack = await repository(
      "halves",
      commit("d"),
      [
        entry({ path: "docs/halves.md", blobSha: "hub-halves", title: "Halves" }),
        entry({ path: "docs/beside.md", blobSha: "hub-halves-beside", title: "Beside" }),
      ],
      { "hub-halves": "# Halves\n\nThree.\n", "hub-halves-beside": "# Beside\n\nOne.\n" },
    );
    // Numbers a half-precision vector holds as they are, so that both precisions say the same.
    await writeSectionVectors(database, KEY, [
      ...[
        [1, 0, 0, 0],
        [0.5, 0.5, 0, 0],
        [0, 1, 0, 0],
      ].map((numbers, section) => ({
        blobSha: "hub-halves",
        section,
        heading: ["Halves", `Part ${section}`],
        offset: section * 10,
        length: 10,
        vector: Float32Array.from(numbers),
      })),
      {
        blobSha: "hub-halves-beside",
        section: 0,
        heading: ["Beside"],
        offset: 0,
        length: 12,
        vector: Float32Array.from([0.75, 0, 0.25, 0]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((found) => found.repoId === pack.repoId)
      .map((found) => found.snapshotId);
    const ask = async (parts: number) =>
      (
        await searchHubSectionVectors(
          database,
          ids,
          KEY,
          Float32Array.from([1, 0, 0, 0]),
          10,
          5000,
          parts,
        )
      ).map((match) => [
        match.path,
        match.section,
        match.heading,
        match.offset,
        match.length,
        Math.round(match.similarity * 1e6) / 1e6,
      ]);
    // Every section compared with its own vector, as the search inside a pack compares them.
    const exact = await ask(0);
    expect(exact.map((match) => `${match[0]} ${match[1]}`)).toEqual([
      "docs/halves.md 0",
      "docs/beside.md 0",
      "docs/halves.md 1",
      "docs/halves.md 2",
    ]);
    expect(await ask(10)).toEqual(exact);
    // A part one of whose sections has no copy, and parts with none, as on the day a database
    // is given their table: those sections are compared with their own vectors.
    await drizzleOf(database).execute(
      sql`delete from section_halves where blob_sha = 'hub-halves' and section = 1`,
    );
    expect(await ask(10)).toEqual(exact);
    expect(await dropSectionHalves(database)).toBeGreaterThan(0);
    expect(await ask(10)).toEqual(exact);
    // The sweep makes them again, for this body and every other the earlier tests wrote.
    let filled = 0;
    for (let step = await fillPartVectors(database, KEY, 100); step > 0; ) {
      filled += step;
      step = await fillPartVectors(database, KEY, 100);
    }
    expect(filled).toBeGreaterThan(0);
    expect(await ask(10)).toEqual(exact);
  });

  it("picks a skill by its head, a part of its own, and gives the head to no document (ADR-0094)", async () => {
    // The sections of a skill say how the work is done; what it is named and says it does
    // is what is asked for, and stands in its head.
    const pack = await repository(
      "head-skill",
      commit("b"),
      [
        entry({
          path: "skills/deck/SKILL.md",
          blobSha: "hub-skill",
          kind: "skill",
          skillDir: "skills/deck",
          name: "deck",
          description: "Drafts a slide deck.",
        }),
        entry({ path: "docs/other.md", blobSha: "hub-other", title: "Other" }),
      ],
      {
        "hub-skill": "# Deck\n\nRead the outline.\n\n## Slides\n\nOne idea a slide.\n",
        "hub-other": "# Other\n\nElse.\n",
      },
    );
    // The same bytes as a document of another pack.
    const copy = await repository(
      "head-copy",
      commit("c"),
      [entry({ path: "notes/deck.md", blobSha: "hub-skill", title: "Deck" })],
      { "hub-skill": "# Deck\n\nRead the outline.\n\n## Slides\n\nOne idea a slide.\n" },
    );
    await writeSectionVectors(database, KEY, [
      {
        blobSha: "hub-skill",
        section: HEAD_SECTION,
        heading: [],
        offset: 0,
        length: 0,
        vector: Float32Array.from([1, 0, 0, 0]),
      },
      ...[0, 1].map((section) => ({
        blobSha: "hub-skill",
        section,
        heading: ["Deck"],
        offset: section * 20,
        length: 20,
        vector: Float32Array.from([0, 1, 0, 0]),
      })),
      {
        blobSha: "hub-other",
        section: 0,
        heading: ["Other"],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0.6, 0, 0.8, 0]),
      },
    ]);
    const ids = (await listSearchablePacks(database))
      .filter((found) => [pack.repoId, copy.repoId].includes(found.repoId))
      .map((found) => found.snapshotId);
    const ask = async (parts: number) =>
      (
        await searchHubSectionVectors(
          database,
          ids,
          KEY,
          Float32Array.from([1, 0, 0, 0]),
          30,
          5000,
          parts,
        )
      ).map((match) => `${match.path} ${match.section}`);
    // One part: the head, for the skill and not for the document that holds the same bytes.
    expect(await ask(1)).toEqual([`skills/deck/SKILL.md ${HEAD_SECTION}`]);
    // Two: the other document as well, and nothing of the sections the head stands before.
    expect(await ask(2)).toEqual([`skills/deck/SKILL.md ${HEAD_SECTION}`, "docs/other.md 0"]);
    // With every section compared the same two lead, then the two sections of each entry
    // of the body, the skill and the document, and no head for the document.
    const every = await ask(0);
    expect(every.slice(0, 2)).toEqual([`skills/deck/SKILL.md ${HEAD_SECTION}`, "docs/other.md 0"]);
    expect([...every.slice(2)].sort()).toEqual([
      "notes/deck.md 0",
      "notes/deck.md 1",
      "skills/deck/SKILL.md 0",
      "skills/deck/SKILL.md 1",
    ]);
  });

  it("finds a body by meaning once its part vectors are filled, where its sections came first", async () => {
    const early = await repository(
      "parts-early",
      commit("a"),
      [entry({ path: "docs/early.md", blobSha: "hub-early", title: "Early" })],
      { "hub-early": "# Early\n\nWritten before.\n" },
    );
    // As the vectors of a deployment are before the sweep has made their parts.
    await drizzleOf(database).execute(
      sql`insert into section_vectors (blob_sha, model, dimensions, sectioning_version, section, heading, "offset", length, vector)
        values ('hub-early', ${KEY.model}, ${KEY.dimensions}, ${KEY.sectioningVersion}, 0, '["Early"]', 0, 10, '[0.8,0,0,0.6]')`,
    );
    const packs = await listSearchablePacks(database);
    const ids = packs.filter((pack) => pack.repoId === early.repoId).map((pack) => pack.snapshotId);
    const all = packs.map((pack) => pack.snapshotId);
    const query = Float32Array.from([1, 0, 0, 0]);
    const pathsOf = async (snapshotIds: readonly string[]): Promise<string[]> =>
      (await searchHubSectionVectors(database, snapshotIds, KEY, query, 50, 5000, 10)).map(
        (match) => match.path,
      );
    // Beside bodies that have their parts, a body without is not among the parts picked.
    const beside = await pathsOf(all);
    expect(beside.length).toBeGreaterThan(0);
    expect(beside).not.toContain("docs/early.md");
    // Searched alone, there is no part to pick, and every section is compared.
    expect(await pathsOf(ids)).toEqual(["docs/early.md"]);
    expect(await fillPartVectors(database, KEY, 100)).toBe(1);
    expect(await pathsOf(ids)).toEqual(["docs/early.md"]);
    expect(await pathsOf(all)).toContain("docs/early.md");
  });

  it("counts the findable entries of the packs searched, and no others", async () => {
    const counted = await repository(
      "counted",
      commit("5"),
      [
        entry({ path: "docs/kept.md", blobSha: "hub-kept" }),
        // Left out by the reading rules: its words are in the index and found by nothing.
        entry({ path: "notes/hidden.md", blobSha: "hub-hidden", visible: false }),
        // Listed, and not searched.
        entry({ path: "src/tool.ts", blobSha: "hub-tool", kind: "other", searchable: false }),
      ],
      { "hub-kept": "quokka marsupial", "hub-hidden": "quokka" },
    );
    const beside = await repository(
      "beside",
      commit("6"),
      [entry({ path: "docs/beside.md", blobSha: "hub-beside" })],
      { "hub-beside": "quokka" },
    );
    const packs = await listSearchablePacks(database);
    const idOf = (scope: RepoScope): string =>
      packs.find((pack) => pack.repoId === scope.repoId)?.snapshotId ?? "";
    const lexemes = queryLexemes("quokka marsupial wombat");
    expect(lexemes).toHaveLength(3);

    // A word nothing holds counts nothing, and the pack beside is not counted unless searched.
    expect(await countHubLexemes(database, [idOf(counted)], lexemes, 5000)).toEqual({
      total: 1,
      counts: [1, 1, 0],
    });
    expect(await countHubLexemes(database, [idOf(counted), idOf(beside)], lexemes, 5000)).toEqual({
      total: 2,
      counts: [2, 1, 0],
    });
    expect(await countHubLexemes(database, [idOf(counted)], [], 5000)).toEqual({
      total: 1,
      counts: [],
    });
  });

  it("reads the findable entries, and not the files a pack holds beside them", async () => {
    // A repository as a deployment holds many: a few documents among thousands of files.
    const files = Array.from({ length: 4000 }, (_, at) =>
      entry({
        path: `src/f${at}.ts`,
        blobSha: `hub-file-${at}`,
        kind: "other",
        searchable: false,
        visible: at % 2 === 0,
      }),
    );
    const documents = Array.from({ length: 20 }, (_, at) =>
      entry({ path: `docs/d${at}.md`, blobSha: `hub-document-${at}` }),
    );
    const large = await repository(
      "large",
      commit("7"),
      [...files, ...documents],
      Object.fromEntries(
        documents.map((document, at) => [
          document.blobSha,
          at === 0 ? "numbat termite" : "termite mound",
        ]),
      ),
    );
    await writeSectionVectors(
      database,
      KEY,
      documents.map((document) => ({
        blobSha: document.blobSha,
        section: 0,
        heading: [],
        offset: 0,
        length: 10,
        vector: Float32Array.from([0, 0, 1, 0]),
      })),
    );
    // What the planner knows of the table is what autovacuum tells it on a deployment.
    await drizzleOf(database).execute(sql`analyze index_entries`);
    const ids = (await listSearchablePacks(database))
      .filter((pack) => pack.repoId === large.repoId)
      .map((pack) => pack.snapshotId);
    const lexemes = queryLexemes("numbat termite");
    const counted = await countHubLexemes(database, ids, lexemes, 5000);
    expect(counted).toEqual({ total: 20, counts: [1, 20] });

    const reading = await readHubStatements(database, {
      snapshotIds: ids,
      lexemes,
      weights: queryWeights(counted.total, counted.counts),
      limit: 10,
      meaning: { key: KEY, query: Float32Array.from([0, 0, 1, 0]), parts: 5 },
    });
    // The count reads the twenty once for each word they hold, from their copy, and nothing of
    // the four thousand files nor of the entries (ADR-0104); the total is what the copy says.
    expect(reading.count.entries).toBeLessThanOrEqual(1 + 20);
    expect(reading.count.indexes).toContain("hub_entries_search_idx");
    expect(reading.count.scans.filter((scan) => / on index_entries$/.test(scan))).toEqual([]);
    // The words read the twenty that hold one once, through the index of the copy's vectors, and
    // the entries of the ten answered alone.
    expect(reading.words?.entries).toBeLessThanOrEqual(20 + 10);
    expect(reading.words?.indexes).toEqual([
      "hub_entries_search_idx",
      "index_entries_snapshot_path_key",
    ]);
    // Not copied, as before the worker's first pass, the entries are read themselves: the count
    // reads the twenty once for the total and once more for each word they hold, and the words
    // read those that hold one once, narrowed as they are read; read a second time by their ids,
    // they were forty (ADR-0098).
    expect(await dropHubEntries(database)).toBeGreaterThan(0);
    const uncopied = await readHubStatements(database, {
      snapshotIds: ids,
      lexemes,
      weights: queryWeights(counted.total, counted.counts),
      limit: 10,
    });
    expect(uncopied.count.entries).toBeLessThanOrEqual(20 + 1 + 20);
    expect(uncopied.count.indexes).toEqual([
      "index_entries_findable_idx",
      "index_entries_search_idx",
    ]);
    expect(uncopied.words?.entries).toBeLessThanOrEqual(20 + 10);
    expect(uncopied.words?.indexes).toEqual([
      "index_entries_search_idx",
      "index_entries_snapshot_path_key",
    ]);
    expect(await countHubLexemes(database, ids, lexemes, 5000)).toEqual(counted);
    expect((await syncHubEntries(database)).copied).toBeGreaterThan(0);
    // How the meaning goes about it is the planner's to choose in a table this small; what it
    // may not do is read the files.
    expect(reading.meaning?.entries).toBeLessThan(1000);
    // Nor read the vectors through a primary key, a page at a time wherever each lies: it reads
    // them in the order they are stored, the sections from their copies at half precision
    // (ADR-0103).
    expect(reading.meaning?.scans).toContainEqual(expect.stringMatching(/ on section_halves$/));
    expect(
      reading.meaning?.scans.filter((scan) =>
        /^Index Scan on (part_vectors|section_halves|section_vectors)$/.test(scan),
      ),
    ).toEqual([]);
  });

  it("tells a statement the server cancelled for its time from any other failure", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(isStatementTimeout(new Error("wrapped", { cause: { code: "57014" } }))).toBe(true);
    expect(isStatementTimeout({ code: "23505" })).toBe(false);
    expect(isStatementTimeout(new Error("plain"))).toBe(false);
    expect(isStatementTimeout(undefined)).toBe(false);
  });
});

describe("the copy of the entries the search across packs reads its words in (ADR-0104)", () => {
  it("copies the findable entries of a snapshot the search covers as its index is written, and nothing else", async () => {
    const served = await repository("copy-served", commit("1"), undefined);
    const servedId = await index(
      served,
      commit("1"),
      [
        entry({ path: "docs/kept.md", blobSha: "copy-kept" }),
        // Left out by the reading rules, and listed without being searched: neither is copied.
        entry({ path: "notes/hidden.md", blobSha: "copy-hidden", visible: false }),
        entry({ path: "src/tool.ts", blobSha: "copy-tool", kind: "other", searchable: false }),
      ],
      { "copy-kept": "axolotl gills", "copy-hidden": "axolotl" },
    );
    // A commit kept beside the one served, a private repository and one its manifest keeps out
    // are searched by nothing, and copied for nothing.
    const kept = await index(
      served,
      commit("2"),
      [entry({ path: "docs/old.md", blobSha: "copy-old" })],
      { "copy-old": "axolotl" },
    );
    const secret = await repository("copy-secret", commit("3"), undefined, {}, "private");
    const secretId = await index(
      secret,
      commit("3"),
      [entry({ path: "docs/secret.md", blobSha: "copy-secret" })],
      { "copy-secret": "axolotl" },
    );
    const quiet = await repository("copy-quiet", commit("4"), undefined);
    const quietId = await index(
      quiet,
      commit("4"),
      [
        entry({
          path: "SKILLCDN.md",
          blobSha: "copy-quiet-manifest",
          kind: "manifest",
          searchable: false,
          frontMatter: { metadata: {}, warnings: [], search: { meaning: true, hub: false } },
        }),
        entry({ path: "docs/quiet.md", blobSha: "copy-quiet" }),
      ],
      { "copy-quiet": "axolotl" },
    );

    const copied = await copies();
    expect(copied.get(servedId)).toEqual(["docs/kept.md"]);
    for (const id of [kept, secretId, quietId]) {
      expect(copied.has(id)).toBe(false);
    }
    // Nothing is left for the worker's pass to do for these.
    await syncHubEntries(database);
    const synced = await copies();
    expect(synced.get(servedId)).toEqual(["docs/kept.md"]);
    expect([kept, secretId, quietId].filter((id) => synced.has(id))).toEqual([]);
    expect(await countHubLexemes(database, [servedId], queryLexemes("axolotl"), 5000)).toEqual({
      total: 1,
      counts: [1],
    });
    // A deployment that does not search across its packs keeps no copy.
    const unsearched = await repository("copy-unsearched", commit("5"), undefined);
    const unsearchedId = await index(
      unsearched,
      commit("5"),
      [entry({ path: "docs/plain.md", blobSha: "copy-plain" })],
      { "copy-plain": "axolotl" },
      { hub: false },
    );
    expect((await copies()).has(unsearchedId)).toBe(false);
  });

  it("answers from the copy as from the entries, and from a part of each", async () => {
    const scopes = [
      await repository(
        "copy-same-one",
        commit("5"),
        [
          entry({ path: "docs/a.md", blobSha: "copy-same-a" }),
          entry({ path: "docs/b.md", blobSha: "copy-same-b" }),
        ],
        { "copy-same-a": "capybara wallow", "copy-same-b": "capybara capybara" },
      ),
      await repository(
        "copy-same-two",
        commit("6"),
        [
          entry({ path: "docs/c.md", blobSha: "copy-same-c" }),
          entry({
            path: "skills/w/SKILL.md",
            blobSha: "copy-same-w",
            kind: "skill",
            skillDir: "skills/w",
            name: "w",
            description: "wallow in mud",
          }),
        ],
        { "copy-same-c": "wallow", "copy-same-w": "" },
      ),
    ];
    const ids = (await listSearchablePacks(database))
      .filter((pack) => scopes.some((scope) => scope.repoId === pack.repoId))
      .map((pack) => pack.snapshotId);
    expect(ids).toHaveLength(2);
    const lexemes = queryLexemes("capybara wallow");
    const answer = async () => {
      const counted = await countHubLexemes(database, ids, lexemes, 5000);
      const weights = queryWeights(counted.total, counted.counts);
      const found = await searchHubEntries(database, ids, lexemes, weights, 10, 5000);
      return { counted, found };
    };

    const fromCopy = await answer();
    expect(fromCopy.counted).toEqual({ total: 4, counts: [2, 3] });
    expect(fromCopy.found.map((row) => row.path).sort()).toEqual([
      "docs/a.md",
      "docs/b.md",
      "docs/c.md",
      "skills/w/SKILL.md",
    ]);
    // A record of the copy is the entry's record, whatever it was found in.
    expect(fromCopy.found.find((row) => row.kind === "skill")).toMatchObject({
      name: "w",
      skillDir: "skills/w",
      description: "wallow in mud",
      searchable: true,
      snapshotId: ids[1],
    });
    // One pack copied and the other not, and neither copied: the same answer, in the same order.
    await drizzleOf(database).execute(
      sql`delete from hub_snapshots where snapshot_id = ${ids[1] ?? ""}`,
    );
    expect(await answer()).toEqual(fromCopy);
    expect(await dropHubEntries(database)).toBeGreaterThan(0);
    expect(await answer()).toEqual(fromCopy);
    const synced = await syncHubEntries(database);
    expect(synced.copied).toBeGreaterThanOrEqual(2);
    expect(synced.left).toBe(0);
    expect(await answer()).toEqual(fromCopy);
  });

  it("follows what the search covers: a newer commit, one indexed before, an index written again, a repository gone private", async () => {
    const scope = await repository("copy-moving", commit("7"), [
      entry({ path: "docs/first.md", blobSha: "copy-first" }),
    ]);
    const idOf = async (): Promise<string> =>
      (await listSearchablePacks(database)).find((pack) => pack.repoId === scope.repoId)
        ?.snapshotId ?? "";
    const one = await idOf();
    expect((await copies()).get(one)).toEqual(["docs/first.md"]);

    // The branch moves on: the commit before is served, and copied, while the newer is indexed.
    const later = new Date(T0.getTime() + 60_000);
    await saveCachedRef(database, scope, "", commit("8"), later);
    expect(await idOf()).toBe(one);
    const two = await index(
      scope,
      commit("8"),
      [entry({ path: "docs/second.md", blobSha: "copy-second" })],
      {},
    );
    expect(await idOf()).toBe(two);
    // The newer is copied as it is written; the one before, searched no longer, goes at the pass.
    expect((await copies()).get(two)).toEqual(["docs/second.md"]);
    await syncHubEntries(database);
    expect((await copies()).has(one)).toBe(false);
    expect((await copies()).get(two)).toEqual(["docs/second.md"]);

    // Back to a commit indexed before: nothing is written, and it is searched from its entries
    // until the pass copies it.
    await saveCachedRef(database, scope, "", commit("7"), new Date(later.getTime() + 60_000));
    expect(await idOf()).toBe(one);
    const firstWord = queryLexemes("first");
    expect(await countHubLexemes(database, [one], firstWord, 5000)).toEqual({
      total: 1,
      counts: [1],
    });
    await syncHubEntries(database);
    expect((await copies()).get(one)).toEqual(["docs/first.md"]);
    expect((await copies()).has(two)).toBe(false);

    // Indexed again under later rules, its copy is of the new index.
    await index(
      scope,
      commit("7"),
      [entry({ path: "docs/again.md", blobSha: "copy-again" })],
      {},
      {
        version: 2,
        now: new Date(later.getTime() + 120_000),
      },
    );
    expect((await copies()).get(one)).toEqual(["docs/again.md"]);

    // Written by a build before this one, which knows no copy: the copy says it is of the index
    // before, so the entries are read, and the pass copies the new index.
    const older = queryLexemes("quoll");
    await drizzleOf(database).execute(sql`
      insert into index_entries (account_id, snapshot_id, path, kind, size, blob_sha, search)
      values (${scope.accountId}, ${one}, 'docs/older-build.md', 'markdown', 10, 'copy-older',
        array_to_tsvector(${sql.param(older)}::text[]))`);
    await drizzleOf(database).execute(
      sql`update snapshots set indexed_at = indexed_at + interval '1 minute' where id = ${one}`,
    );
    expect(await countHubLexemes(database, [one], older, 5000)).toEqual({
      total: 2,
      counts: [1],
    });
    expect((await syncHubEntries(database)).dropped).toBeGreaterThanOrEqual(1);
    expect((await copies()).get(one)).toEqual(["docs/again.md", "docs/older-build.md"]);

    // Private now: the pass drops it, and the snapshot gone takes its copy with it.
    await drizzleOf(database).execute(
      sql`update repos set visibility = 'private' where id = ${scope.repoId}`,
    );
    await syncHubEntries(database);
    expect((await copies()).has(one)).toBe(false);
    await drizzleOf(database).execute(
      sql`update repos set visibility = 'public' where id = ${scope.repoId}`,
    );
    await syncHubEntries(database);
    expect((await copies()).has(one)).toBe(true);
    await drizzleOf(database).execute(sql`delete from snapshots where id = ${one}`);
    expect((await copies()).has(one)).toBe(false);
  });

  it("copies at most as many snapshots a pass as it is given, and says how many are left", async () => {
    await dropHubEntries(database);
    const searched = (await listSearchablePacks(database)).length;
    expect(searched).toBeGreaterThan(2);
    const first = await syncHubEntries(database, 2);
    expect(first).toMatchObject({ copied: 2, left: searched - 2 });
    const rest = await syncHubEntries(database);
    expect(rest).toMatchObject({ copied: searched - 2, left: 0 });
    expect(await syncHubEntries(database)).toEqual({ dropped: 0, copied: 0, left: 0 });
  });
});
