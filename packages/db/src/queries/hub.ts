import { type LexemeFrequencies, type LicenseFact, serializeSearchQuery } from "@skillcdn/core";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import {
  accounts,
  hubEntries,
  hubSnapshots,
  indexEntries,
  partVectors,
  repoAliases,
  repoRefs,
  repos,
  sectionHalves,
  sectionVectors,
  snapshots,
} from "../schema.js";
import { BY_PATH, type EntryRecord, entryColumns, FINDABLE, rankOf } from "./entries.js";
import {
  COMPARED,
  partOfSection,
  partVectorsPresent,
  underKey,
  type VectorKey,
  vectorLiteral,
} from "./vectors.js";

// The search across every pack a deployment serves (ADR-0070): which snapshots it covers, the
// words over all of them at once, read from a copy of the entries searched (ADR-0104), and the
// sections nearest in meaning, of the parts of their bodies nearest in meaning (ADR-0092),
// compared at half precision (ADR-0103). Every statement runs under a time limit of its own,
// since it reads every pack there is, and the caller decides what a search that ran out of time
// answers.

/** A pack the search across packs covers: the snapshot it is served from, and how it is addressed. */
export interface SearchablePack {
  readonly snapshotId: string;
  readonly accountId: string;
  readonly repoId: string;
  readonly host: string;
  /** The owner's login, as the host spells it. */
  readonly owner: string;
  /** The owner's id at the host, which its picture is served under. */
  readonly hostAccountId: string;
  /** The repository's name, as the host spells it. */
  readonly name: string;
  /** The license that governs the repository outside its skills (ADR-0026); null before indexed. */
  readonly license: LicenseFact | null;
  /** Whether the snapshot has a root manifest: what makes a repository a pack of its own saying. */
  readonly hasManifest: boolean;
  /** How many skills the snapshot lists. */
  readonly skillCount: number;
  /**
   * When the git host last confirmed a name of the repository, which is when it was last seen
   * to be what the index says it is; null where no name of it is kept. What the index calls
   * public is public as of then (ADR-0097).
   */
  readonly confirmedAt: Date | null;
}

/**
 * The public repositories with an index to search, each at the snapshot a mount of its default
 * branch is served from: the ref's commit where that has an index, else the ref's previous
 * commit (ADR-0068); without the repositories whose root manifest keeps them out of the search
 * across packs (`search.hub: false`, ADR-0070). In the order of their addresses. Public is what
 * the index recorded when the host was last asked: whoever shows a result to everyone asks
 * again where `confirmedAt` is long ago (ADR-0097).
 */
export async function listSearchablePacks(database: Database): Promise<SearchablePack[]> {
  const hasManifest = sql<boolean>`exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest')`;
  const skillCount = sql<number>`(select count(*)::int from ${indexEntries} k where k.snapshot_id = ${snapshots.id} and k.kind = 'skill' and k.visible)`;
  const confirmedAt =
    sql<Date | null>`(select max(a.checked_at) from ${repoAliases} a where a.repo_id = ${repos.id})`.mapWith(
      (value: string | Date | null) => (value === null ? null : new Date(value)),
    );
  return drizzleOf(database)
    .select({
      snapshotId: snapshots.id,
      accountId: snapshots.accountId,
      repoId: repos.id,
      host: repos.host,
      owner: accounts.login,
      hostAccountId: accounts.hostAccountId,
      name: repos.name,
      license: snapshots.license,
      hasManifest,
      skillCount,
      confirmedAt,
    })
    .from(repos)
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .innerJoin(repoRefs, DEFAULT_BRANCH)
    .innerJoin(snapshots, SERVED)
    .where(SEARCHED)
    .orderBy(accounts.login, repos.name);
}

// What makes a snapshot one the search across packs covers, said once for the list of them and
// for the copy of their entries.

/** The ref of a repository's default branch, which is the empty one. */
const DEFAULT_BRANCH = and(eq(repoRefs.repoId, repos.id), eq(repoRefs.ref, ""));
/** The snapshot of the commit the default branch is served from: its own where it has an index, else the one before. */
const SERVED = and(
  eq(snapshots.repoId, repos.id),
  sql`${snapshots.commitSha} = case when exists (select 1 from ${snapshots} n where n.repo_id = ${repos.id} and n.commit_sha = ${repoRefs.commitSha} and n.index_version > 0) then ${repoRefs.commitSha} else ${repoRefs.previousCommitSha} end`,
  sql`${snapshots.indexVersion} > 0`,
);
/** A public repository whose root manifest does not keep it out (`search.hub: false`). */
const SEARCHED = and(
  eq(repos.visibility, "public"),
  sql`not exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest' and (m.front_matter -> 'search' ->> 'hub') = 'false')`,
);

/** The ids of the snapshots the search across packs covers, or of the one named if it is one. */
const searchedSnapshots = (runner: Runner, only?: string) =>
  runner
    .select({ id: snapshots.id })
    .from(repos)
    .innerJoin(repoRefs, DEFAULT_BRANCH)
    .innerJoin(snapshots, SERVED)
    .where(and(SEARCHED, only === undefined ? undefined : eq(snapshots.id, only)));

// The words of the search across packs are counted and matched in a copy of the entries it
// searches (ADR-0104). The index of the search vectors holds every commit a deployment keeps, and
// a word looked up in it read the row of every entry that holds the word, most of them of commits
// no search covers, before they were turned away: the count of a deployment that had been idle
// waited seconds for those reads. The copy holds the findable entries of the snapshots searched
// and their vectors, and nothing else. A snapshot is copied in the transaction that writes its
// index where it is searched then, and by the worker's pass otherwise, which also drops what is
// searched no longer. A snapshot searched and not copied as its index is now is read as before,
// from the entries, so that nothing is missed and nothing is counted twice.

/** How many snapshots one pass of {@link syncHubEntries} copies: the rest wait for the next. */
export const HUB_COPY_LIMIT = 1000;

/**
 * Copies the findable entries of a snapshot to `hub_entries`, with the row of `hub_snapshots` that
 * says so, where the search across packs covers it and they are not copied as its index is now.
 * True where it copied. Runs in the caller's transaction: its own, or the one that wrote the
 * index, which holds the snapshot's row already.
 */
export async function copyHubSnapshot(tx: Runner, snapshotId: string): Promise<boolean> {
  // An index written meanwhile takes the snapshot's row for update, and waits for this, or this
  // for it: the copy is of one index, and its row says which.
  const held = await tx.execute(
    sql`select 1 from ${snapshots} where ${snapshots.id} = ${snapshotId} for key share`,
  );
  if (held.rows.length === 0 || (await searchedSnapshots(tx, snapshotId)).length === 0) {
    return false;
  }
  await tx.execute(sql`
    delete from ${hubSnapshots}
    where ${hubSnapshots.snapshotId} = ${snapshotId}
      and ${hubSnapshots.indexedAt} is distinct from
        (select s.indexed_at from ${snapshots} s where s.id = ${snapshotId})`);
  const marked = await tx.execute(sql`
    insert into ${hubSnapshots} (snapshot_id, indexed_at, entries)
    select s.id, s.indexed_at,
      (select count(*)::int from ${indexEntries} where ${indexEntries.snapshotId} = s.id and ${FINDABLE})
    from ${snapshots} s where s.id = ${snapshotId} and s.indexed_at is not null
    on conflict do nothing
    returning snapshot_id`);
  if (marked.rows.length === 0) {
    return false;
  }
  await tx.execute(sql`
    insert into ${hubEntries} (snapshot_id, path, search)
    select ${indexEntries.snapshotId}, ${indexEntries.path}, ${indexEntries.search}
    from ${indexEntries}
    where ${indexEntries.snapshotId} = ${snapshotId} and ${FINDABLE}
    order by ${indexEntries.path}`);
  return true;
}

/**
 * Drops every copy, as a deployment that no longer searches across its packs does. Says how many
 * snapshots' copies went.
 */
export async function dropHubEntries(database: Database): Promise<number> {
  const dropped = await drizzleOf(database).execute(sql`delete from ${hubSnapshots}`);
  return dropped.rowCount ?? 0;
}

/** What one pass of {@link syncHubEntries} did. */
export interface HubCopying {
  /** Snapshots whose copies went: searched no longer, or indexed since. */
  readonly dropped: number;
  /** Snapshots copied. */
  readonly copied: number;
  /** Snapshots searched and still not copied, for the next pass. */
  readonly left: number;
}

/**
 * Brings the copy of the entries searched across the packs in line with what is searched now
 * (ADR-0104): drops the copies of snapshots no longer searched, or indexed since they were
 * copied, and copies those searched without one, at most `limit`, each in a transaction of its
 * own. What a search covers changes when a default branch moves to a commit with an index, or a
 * repository becomes public, which writes no index, and when an index is written by a build
 * before this one, which copies nothing.
 */
export async function syncHubEntries(
  database: Database,
  limit: number = HUB_COPY_LIMIT,
): Promise<HubCopying> {
  const db = drizzleOf(database);
  const dropped = await db.execute(sql`
    delete from ${hubSnapshots} h
    where h.snapshot_id not in ${searchedSnapshots(db)}
      or h.indexed_at is distinct from (select s.indexed_at from ${snapshots} s where s.id = h.snapshot_id)`);
  const missing = await db.execute<{ id: string }>(sql`
    select x.id from ${searchedSnapshots(db)} x
    where not exists (select 1 from ${hubSnapshots} h where h.snapshot_id = x.id)
    order by x.id`);
  let copied = 0;
  for (const { id } of missing.rows.slice(0, Math.max(0, limit))) {
    if (await db.transaction((tx) => copyHubSnapshot(tx, id))) {
      copied += 1;
    }
  }
  return {
    dropped: dropped.rowCount ?? 0,
    copied,
    left: Math.max(0, missing.rows.length - Math.max(0, limit)),
  };
}

/** An entry of one of the packs searched, with the snapshot it belongs to. */
export interface HubEntryRecord extends EntryRecord {
  readonly snapshotId: string;
}

/** A section of an entry of one of the packs searched, as near to the query as the search found it. */
export interface HubSectionMatch extends HubEntryRecord {
  readonly section: number;
  readonly heading: readonly string[];
  readonly offset: number;
  readonly length: number;
  /** Cosine similarity to the query: 1 for the same direction, 0 for none. */
  readonly similarity: number;
}

/** Bounds the statements of the transaction to `timeoutMs`, after which the server cancels them. */
const bounded = (timeoutMs: number) =>
  sql`select set_config('statement_timeout', ${String(Math.max(1, Math.round(timeoutMs)))}, true)`;

/** The server cancelled a statement that ran out of its time (`query_canceled`). */
export function isStatementTimeout(error: unknown): boolean {
  const codeOf = (value: unknown): string | undefined =>
    typeof value === "object" && value !== null && "code" in value
      ? String((value as { code: unknown }).code)
      : undefined;
  if (codeOf(error) === "57014") {
    return true;
  }
  const cause =
    typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return codeOf(cause) === "57014";
}

/** What runs a statement: the pool, or a transaction of it. */
type Runner = Pick<Drizzle, "select" | "execute">;

/**
 * The entries of the snapshots searched. The snapshots travel as one array however many there
 * are, so a statement that names them more than once grows by an array and not by a parameter
 * for each.
 */
const among = (snapshotIds: readonly string[]) =>
  sql`${indexEntries.snapshotId} = any(${sql.param([...snapshotIds])}::uuid[])`;

// The entries that hold a word are taken from the index of the search vectors, of the copy
// (ADR-0104) or of the entries, and narrowed to the snapshots searched as they are read
// (ADR-0090, ADR-0098). Three things in how the statements are written keep a word to what it
// has to cost.
//
// The word reaches the comparison as a value the planner does not look into, a row of a function
// or a subquery, so that it expects few entries to hold it and goes through the index. Left to
// expect a word in many entries, it reads the entries of the snapshots, or the table, and tests
// each vector.
//
// The read of the index stands alone behind an `offset 0`, which nothing is pushed into: with
// the snapshots or what makes an entry findable beside the word in one read, the planner takes
// an index that names those and tests every vector it finds there, whatever the word, which is
// what the count across a deployment's packs once ran out of time on. What the read hands on is
// narrowed at once, on the row it has in hand. Narrowed later, by the ids of every entry that
// holds a word, each of those entries was read a second time to be turned away, and most of
// them belong to commits kept from before and to repositories no search covers.
//
// And a vector is unpacked once a row. It is kept apart from its row, and whatever names the
// column fetches it again, so that a rank of ten words fetched it ten times. The entries kept
// hand on a copy of it, behind a second `offset 0` that keeps the planner from writing the
// column back into every use.

/**
 * The stored vector as a value of its own: a copy that changes nothing, since the weight is set
 * on the lexemes of an empty list. A concatenation with an empty vector says the same and
 * costs several times the copy, where it was measured.
 */
const unpackedOf = (vector: SQL): SQL => sql`setweight(${vector}, 'D', '{}'::text[])`;

/**
 * The snapshots searched, parted into those whose entries are copied as their index is now
 * (ADR-0104) and the rest, which are read from the entries themselves. Read in the transaction of
 * the statement it is for, which sees the copies as it saw this.
 */
interface Parted {
  readonly copied: readonly string[];
  readonly rest: readonly string[];
}

async function partedOf(runner: Runner, snapshotIds: readonly string[]): Promise<Parted> {
  const rows = await runner.execute<{ snapshot_id: string }>(sql`
    select h.snapshot_id from ${hubSnapshots} h
    join ${snapshots} s on s.id = h.snapshot_id and s.indexed_at = h.indexed_at
    where h.snapshot_id = any(${sql.param([...snapshotIds])}::uuid[])`);
  const copied = new Set(rows.rows.map((row) => row.snapshot_id));
  return {
    copied: snapshotIds.filter((id) => copied.has(id)),
    rest: snapshotIds.filter((id) => !copied.has(id)),
  };
}

/** The statements of the words read a snapshot that does not change while they run. */
const UNCHANGING = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

/**
 * The count of the findable entries, as row 0, and of those that hold each lexeme, as the row of
 * its place from 1; a lexeme no entry holds has no row. The total of the copied snapshots is
 * what their rows of `hub_snapshots` say, and that of the rest is read from the index of the
 * findable entries alone.
 */
function countStatement(parted: Parted, lexemes: readonly string[]): SQL {
  const { copied, rest } = parted;
  const totals = [
    ...(copied.length === 0
      ? []
      : [
          sql`(select coalesce(sum(h.entries), 0)::int from ${hubSnapshots} h where h.snapshot_id = any(${sql.param([...copied])}::uuid[]))`,
        ]),
    ...(rest.length === 0
      ? []
      : [sql`(select count(*)::int from ${indexEntries} where ${and(among(rest), FINDABLE)})`]),
  ];
  const total = sql`select 0 as at, (${sql.join(totals, sql` + `)})::int as entries`;
  if (lexemes.length === 0) {
    return total;
  }
  const holding = [
    ...(copied.length === 0
      ? []
      : [
          sql`(select count(*)::int from (
            select c.snapshot_id from ${hubEntries} c
            where c.search @@ asked.word::tsquery
            offset 0
          ) holding
          where holding.snapshot_id = any(${sql.param([...copied])}::uuid[]))`,
        ]),
    ...(rest.length === 0
      ? []
      : [
          sql`(select count(*)::int from (
            select e.snapshot_id, e.visible from ${indexEntries} e
            where e.search @@ asked.word::tsquery
            offset 0
          ) holding
          where holding.visible and holding.snapshot_id = any(${sql.param([...rest])}::uuid[]))`,
        ]),
  ];
  const asked = sql.param(lexemes.map((lexeme) => serializeSearchQuery([lexeme])));
  // Behind its `offset 0` the count of a word is counted once, and not again for the condition
  // that leaves out a word nothing holds.
  return sql`${total}
    union all
    select asked.at::int, held.entries
    from unnest(${asked}::text[]) with ordinality as asked (word, at)
    cross join lateral (select (${sql.join(holding, sql` + `)})::int as entries offset 0) held
    where held.entries > 0`;
}

/**
 * The findable entries that hold any of the lexemes, best first and at most `limit`: those of
 * the copied snapshots matched in the copy, the rest in the entries, each with its vector
 * unpacked once (ADR-0098), and the columns of an entry read for those answered alone.
 */
function wordsStatement(
  parted: Parted,
  lexemes: readonly string[],
  weights: readonly number[] | undefined,
  limit: number,
): SQL {
  const { copied, rest } = parted;
  const words = sql`(select ${serializeSearchQuery(lexemes)}::tsquery)`;
  const branches = [
    ...(copied.length === 0
      ? []
      : [
          sql`(select holding.snapshot_id, holding.path, ${unpackedOf(sql`holding.search`)} as unpacked
          from (
            select c.snapshot_id, c.path, c.search from ${hubEntries} c
            where c.search @@ ${words}
            offset 0
          ) holding
          where holding.snapshot_id = any(${sql.param([...copied])}::uuid[])
          offset 0)`,
        ]),
    ...(rest.length === 0
      ? []
      : [
          sql`(select holding.snapshot_id, holding.path, ${unpackedOf(sql`holding.search`)} as unpacked
          from (
            select e.snapshot_id, e.path, e.search, e.visible from ${indexEntries} e
            where e.search @@ ${words}
            offset 0
          ) holding
          where holding.visible and holding.snapshot_id = any(${sql.param([...rest])}::uuid[])
          offset 0)`,
        ]),
  ];
  const columns = sql.join(
    Object.entries(entryColumns).map(([name, column]) => sql`${column} as ${sql.identifier(name)}`),
    sql`, `,
  );
  return sql`
    select ${columns}, ${indexEntries.snapshotId} as "snapshotId"
    from (
      select found.snapshot_id, found.path, ${rankOf(lexemes, weights, sql`found.unpacked`)} as rank
      from (${sql.join(branches, sql` union all `)}) found
      order by rank desc, found.snapshot_id, found.path collate "C"
      limit ${limit}
    ) top
    join ${indexEntries}
      on ${indexEntries.snapshotId} = top.snapshot_id and ${indexEntries.path} = top.path
    order by top.rank desc, top.snapshot_id, top.path collate "C"`;
}

/** A part of a body a search picked: the body, the part's place in it, and how many sections it has. */
interface PickedPart {
  readonly blobSha: string;
  readonly part: number;
  readonly sections: number;
}

/**
 * The two statements of the comparison by meaning read their tables in the order they are
 * stored (ADR-0103). Told nothing, the planner reads the parts of the bodies searched, or the
 * sections of the parts picked, through their primary key, in the order of the bodies' hashes:
 * one page at a time and each somewhere else, which a database that has them in memory does not
 * feel and one that reads them from its storage waits for page by page, three and a half seconds
 * where it was measured. Without a plain index scan it marks the pages first and reads them in
 * order, which the database reads ahead of, and the same where they are in memory.
 */
const READ_AS_STORED = sql`select set_config('enable_indexscan', 'off', true)`;
const READ_ANY_WAY = sql`select set_config('enable_indexscan', 'on', true)`;

/**
 * The parts nearest the query among the bodies of the findable entries searched, at most
 * `parts` (ADR-0092): an exact comparison with the vector of every such part, an eighth of the
 * sections and fewer. A body two packs hold is one body here. The bodies searched are handed on
 * as one array, as the entries that hold a word are (ADR-0090): joined in, the planner looks the
 * parts of each body up one body at a time, which took three times as long where it was measured.
 * Run after {@link READ_AS_STORED}.
 */
function partsStatement(
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  parts: number,
): SQL {
  return sql`
    select p.blob_sha, p.part, p.sections
    from ${partVectors} p
    where p.model = ${key.model} and p.dimensions = ${key.dimensions}
      and p.sectioning_version = ${key.sectioningVersion}
      and p.blob_sha = any(array(
        select distinct e.blob_sha from ${indexEntries} e
        where e.snapshot_id = any(${sql.param([...snapshotIds])}::uuid[])
          and e.visible and e.search is not null))
    order by p.vector <=> ${vectorLiteral(query)}::halfvec, p.blob_sha, p.part
    limit ${parts}`;
}

const pickedOf = (
  rows: readonly { blob_sha: string; part: number; sections: number }[],
): PickedPart[] =>
  rows.map((row) => ({
    blobSha: row.blob_sha,
    part: Number(row.part),
    sections: Number(row.sections),
  }));

/** A section the second step compared, with the entry it belongs to, as the database answers it. */
interface ComparedRow extends HubEntryRecord {
  readonly section: number;
  readonly heading: string[];
  readonly offset: number;
  readonly length: number;
  readonly distance: number;
}

/**
 * The sections of the parts picked, nearest the query first, at most `limit`, with the entry
 * each belongs to (ADR-0103): compared with the copies of their vectors at half precision, which
 * lie in their rows, a part's together, where a section's own vector lies beside its row and is
 * read alone. Where the copies of a part's sections are not all made, as on a database the sweep
 * has not been through since it was given their table, that part's sections are compared with
 * their own vectors, so an answer that says it is by meaning has looked. The heading, offset and
 * length of a section are read for the sections answered alone. Run after {@link READ_AS_STORED}.
 */
function halvesStatement(
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
  picked: readonly PickedPart[],
): SQL {
  const literal = vectorLiteral(query);
  const blobs = sql.param(picked.map((part) => part.blobSha));
  const ofKey = (alias: string) =>
    sql`${sql.raw(alias)}.model = ${key.model} and ${sql.raw(alias)}.dimensions = ${key.dimensions}
      and ${sql.raw(alias)}.sectioning_version = ${key.sectioningVersion}`;
  const columns = sql.join(
    Object.entries(entryColumns).map(([name, column]) => sql`${column} as ${sql.identifier(name)}`),
    sql`, `,
  );
  return sql`
    with picked (blob_sha, part, sections) as (
      select * from unnest(${blobs}::text[], ${sql.param(picked.map((part) => part.part))}::integer[],
        ${sql.param(picked.map((part) => part.sections))}::integer[])
    ),
    halved as (
      select h.blob_sha, ${partOfSection(sql.raw("h.section"))} as part, h.section,
        h.vector <=> ${literal}::halfvec as distance
      from ${sectionHalves} h
      where ${ofKey("h")} and h.blob_sha = any(${blobs}::text[])
        and (h.blob_sha, ${partOfSection(sql.raw("h.section"))}) in (select blob_sha, part from picked)
    ),
    counted as (
      select blob_sha, part, count(*) as halves from halved group by blob_sha, part
    ),
    whole as (
      select p.blob_sha, p.part from picked p
      left join counted c on c.blob_sha = p.blob_sha and c.part = p.part
      where p.sections > coalesce(c.halves, 0)
    ),
    near as (
      select blob_sha, section, distance from halved
      union all
      select v.blob_sha, v.section, v.vector <=> ${literal}::vector
      from ${sectionVectors} v
      where ${ofKey("v")}
        and (v.blob_sha, ${partOfSection(sql.raw("v.section"))}) in (select blob_sha, part from whole)
        and not exists (select 1 from halved x where x.blob_sha = v.blob_sha and x.section = v.section)
    ),
    top as (
      select ${columns}, ${indexEntries.snapshotId} as "snapshotId", near.blob_sha as matched,
        near.section, near.distance
      from near join ${indexEntries} on ${indexEntries.blobSha} = near.blob_sha
      where ${among(snapshotIds)} and ${FINDABLE}
        and (near.section >= 0 or ${indexEntries.kind} = 'skill')
      order by near.distance, ${indexEntries.snapshotId}, ${BY_PATH}, near.section
      limit ${limit}
    )
    select top.*, v.heading, v."offset", v.length
    from top join ${sectionVectors} v
      on v.blob_sha = top.matched and ${ofKey("v")} and v.section = top.section
    order by top.distance, top."snapshotId", top.path collate "C", top.section`;
}

/** Every section of the packs searched compared with the query, exactly: where no part is picked. */
function meaningStatement(
  runner: Runner,
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
) {
  const distance = sql<number>`${sectionVectors.vector} <=> ${vectorLiteral(query)}::vector`;
  return runner
    .select({
      ...entryColumns,
      snapshotId: indexEntries.snapshotId,
      section: sectionVectors.section,
      heading: sectionVectors.heading,
      offset: sectionVectors.offset,
      length: sectionVectors.length,
      distance,
    })
    .from(indexEntries)
    .innerJoin(sectionVectors, eq(sectionVectors.blobSha, indexEntries.blobSha))
    .where(and(among(snapshotIds), FINDABLE, underKey(key), COMPARED))
    .orderBy(distance, indexEntries.snapshotId, BY_PATH, sectionVectors.section)
    .limit(limit);
}

/**
 * How many findable entries the packs hold together, and how many of them hold each lexeme
 * (ADR-0069): what a query's words are weighed by across every pack.
 */
export async function countHubLexemes(
  database: Database,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  timeoutMs: number,
): Promise<LexemeFrequencies> {
  if (snapshotIds.length === 0) {
    return { total: 0, counts: lexemes.map(() => 0) };
  }
  const rows = await drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    const result = await tx.execute<{ at: number; entries: number }>(
      countStatement(await partedOf(tx, snapshotIds), lexemes),
    );
    return result.rows;
  }, UNCHANGING);
  const counted = new Map(rows.map((row) => [Number(row.at), Number(row.entries)]));
  return { total: counted.get(0) ?? 0, counts: lexemes.map((_, at) => counted.get(at + 1) ?? 0) };
}

/**
 * The findable entries of the packs whose vector holds any of the query's lexemes, best first
 * across every pack, as `searchEntries` ranks them inside one (ADR-0069): the weighed rank, a
 * skill ranked as a document is (ADR-0095), ties by pack and then by path. At most `limit`.
 */
export async function searchHubEntries(
  database: Database,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  weights: readonly number[] | undefined,
  limit: number,
  timeoutMs: number,
): Promise<HubEntryRecord[]> {
  if (snapshotIds.length === 0 || lexemes.length === 0) {
    return [];
  }
  return drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    const found = await tx.execute<Record<string, unknown>>(
      wordsStatement(await partedOf(tx, snapshotIds), lexemes, weights, limit),
    );
    // The statement names its columns as the record does.
    return found.rows as unknown as HubEntryRecord[];
  }, UNCHANGING);
}

/**
 * The sections of the packs' findable entries nearest to a query vector, best first and at most
 * `limit`, with the entry each belongs to, in two steps (ADR-0092): the `parts` parts of their
 * bodies nearest the query are picked by the vector of each part, the mean of its sections',
 * a skill's head being a part of its own (ADR-0094), and the sections of those parts are then
 * compared at half precision (ADR-0103), both read in the order their tables are stored. The
 * two statements share the one time limit. A body without part vectors yet is not found beside
 * bodies that have theirs, which is the sweep's to end (`fillPartVectors`). With `parts` at 0,
 * in a database that keeps no part vectors, and where none of the bodies searched has a part
 * yet, as after an update that brought the parts or an import of vectors made elsewhere, every
 * section of the packs is compared exactly, as `searchSectionVectors` compares inside one mount
 * (ADR-0064): an answer that says it is by meaning has looked.
 */
export async function searchHubSectionVectors(
  database: Database,
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
  timeoutMs: number,
  parts: number,
): Promise<HubSectionMatch[]> {
  if (snapshotIds.length === 0) {
    return [];
  }
  if (query.length !== key.dimensions) {
    throw new RangeError(
      `a query of ${query.length} dimensions cannot be searched under a key of ${key.dimensions}`,
    );
  }
  const rows = await drizzleOf(database).transaction(async (tx): Promise<ComparedRow[]> => {
    await tx.execute(bounded(timeoutMs));
    if (parts <= 0 || !(await partVectorsPresent(tx))) {
      return meaningStatement(tx, snapshotIds, key, query, limit);
    }
    const started = performance.now();
    await tx.execute(READ_AS_STORED);
    const picked = await tx.execute<{ blob_sha: string; part: number; sections: number }>(
      partsStatement(snapshotIds, key, query, parts),
    );
    await tx.execute(bounded(timeoutMs - (performance.now() - started)));
    if (picked.rows.length === 0) {
      await tx.execute(READ_ANY_WAY);
      return meaningStatement(tx, snapshotIds, key, query, limit);
    }
    const compared = await tx.execute<Record<string, unknown>>(
      halvesStatement(snapshotIds, key, query, limit, pickedOf(picked.rows)),
    );
    // The statement names its columns as the record does, and adds the body it matched by.
    const answered = compared.rows as unknown as readonly (ComparedRow & { matched: string })[];
    return answered.map(({ matched: _, ...row }) => row);
  });
  return rows.map(({ distance: away, ...row }) => ({ ...row, similarity: 1 - Number(away) }));
}

/** What one statement of the search across packs read to answer, as the database counted it. */
export interface HubStatementReading {
  /** How long the statement ran, in milliseconds. */
  readonly ms: number;
  /**
   * The rows of `index_entries` and of its copy `hub_entries` it visited: those it kept and those
   * a condition turned away.
   */
  readonly entries: number;
  /** The pages it read, wherever they were. */
  readonly pages: number;
  /** Those of the pages that were not in the database's memory. */
  readonly pagesFromDisk: number;
  /** The indexes it went through. */
  readonly indexes: readonly string[];
  /** How it read each table it read, as `Bitmap Heap Scan on part_vectors`: once each, sorted. */
  readonly scans: readonly string[];
}

/** A question to the search across packs, for {@link readHubStatements}. */
export interface HubQuestion {
  readonly snapshotIds: readonly string[];
  readonly lexemes: readonly string[];
  readonly weights?: readonly number[] | undefined;
  readonly limit: number;
  /**
   * The key and the query's vector, where the meaning is measured as well, and how many parts
   * are picked before their sections are compared; 0 or left out, every section is compared.
   */
  readonly meaning?:
    | { readonly key: VectorKey; readonly query: Float32Array; readonly parts?: number | undefined }
    | undefined;
}

interface PlanNode {
  readonly "Node Type"?: string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  readonly "Actual Rows"?: number;
  readonly "Actual Loops"?: number;
  readonly "Rows Removed by Filter"?: number;
  readonly "Rows Removed by Index Recheck"?: number;
  readonly "Shared Hit Blocks"?: number;
  readonly "Shared Read Blocks"?: number;
  readonly Plans?: readonly PlanNode[];
}

function readingOf(explained: unknown): HubStatementReading {
  const [top] = explained as readonly [
    { readonly Plan: PlanNode; readonly "Execution Time": number },
  ];
  let entries = 0;
  const indexes = new Set<string>();
  const scans = new Set<string>();
  const walk = (node: PlanNode): void => {
    const loops = node["Actual Loops"] ?? 1;
    if (node["Relation Name"] === "index_entries" || node["Relation Name"] === "hub_entries") {
      entries +=
        ((node["Actual Rows"] ?? 0) +
          (node["Rows Removed by Filter"] ?? 0) +
          (node["Rows Removed by Index Recheck"] ?? 0)) *
        loops;
    }
    if (node["Relation Name"] !== undefined) {
      scans.add(`${node["Node Type"]} on ${node["Relation Name"]}`);
    }
    if (node["Index Name"] !== undefined) {
      indexes.add(node["Index Name"]);
    }
    for (const child of node.Plans ?? []) {
      walk(child);
    }
  };
  walk(top.Plan);
  const hit = top.Plan["Shared Hit Blocks"] ?? 0;
  const read = top.Plan["Shared Read Blocks"] ?? 0;
  return {
    ms: top["Execution Time"],
    entries: Math.round(entries),
    pages: hit + read,
    pagesFromDisk: read,
    indexes: [...indexes].sort(),
    scans: [...scans].sort(),
  };
}

/**
 * Runs the statements of a search across packs as the functions above run them, and says what
 * each read: for the measurement that keeps a search's cost from following what a deployment
 * holds beside what it searches (`eval:hub`), and for the tests of the same. Without a time
 * limit, so that a statement that would be cancelled is measured to its end.
 */
export async function readHubStatements(
  database: Database,
  question: HubQuestion,
): Promise<{
  readonly count: HubStatementReading;
  readonly words: HubStatementReading | undefined;
  readonly meaning: HubStatementReading | undefined;
}> {
  const explain = async (
    statement: (tx: Runner) => SQL,
    asStored = false,
  ): Promise<HubStatementReading> =>
    drizzleOf(database).transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '0', true)`);
      if (asStored) {
        await tx.execute(READ_AS_STORED);
      }
      const result = await tx.execute<{ "QUERY PLAN": unknown }>(
        sql`explain (analyze, buffers, timing off, format json) ${statement(tx)}`,
      );
      return readingOf(result.rows[0]?.["QUERY PLAN"]);
    });
  const { snapshotIds, lexemes, weights, limit, meaning } = question;
  /** The two steps of the meaning as one reading, or the one statement that compares everything. */
  const explainMeaning = async (
    asked: NonNullable<HubQuestion["meaning"]>,
  ): Promise<HubStatementReading> => {
    const parts = asked.parts ?? 0;
    const everySection = () =>
      explain((tx) => meaningStatement(tx, snapshotIds, asked.key, asked.query, limit).getSQL());
    if (parts <= 0 || !(await partVectorsPresent(drizzleOf(database)))) {
      return everySection();
    }
    const statement = partsStatement(snapshotIds, asked.key, asked.query, parts);
    const picking = await explain(() => statement, true);
    const picked = await drizzleOf(database).execute<{
      blob_sha: string;
      part: number;
      sections: number;
    }>(statement);
    if (picked.rows.length === 0) {
      return everySection();
    }
    const comparing = await explain(
      () => halvesStatement(snapshotIds, asked.key, asked.query, limit, pickedOf(picked.rows)),
      true,
    );
    return {
      ms: picking.ms + comparing.ms,
      entries: picking.entries + comparing.entries,
      pages: picking.pages + comparing.pages,
      pagesFromDisk: picking.pagesFromDisk + comparing.pagesFromDisk,
      indexes: [...new Set([...picking.indexes, ...comparing.indexes])].sort(),
      scans: [...new Set([...picking.scans, ...comparing.scans])].sort(),
    };
  };
  const parted = await partedOf(drizzleOf(database), snapshotIds);
  return {
    count: await explain(() => countStatement(parted, lexemes)),
    words:
      lexemes.length === 0
        ? undefined
        : await explain(() => wordsStatement(parted, lexemes, weights, limit)),
    meaning: meaning === undefined ? undefined : await explainMeaning(meaning),
  };
}
