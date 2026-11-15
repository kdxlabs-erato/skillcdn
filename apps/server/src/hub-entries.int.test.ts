import { listSearchablePacks } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyHubEntries } from "./jobs/hub-entries.js";
import { makeSnapshot } from "./testing/made-snapshot.js";

// The worker's pass over the copy of the entries the search across packs reads its words in
// (ADR-0104): it copies what is searched and no index write copied, and keeps nothing where the
// deployment does not search across its packs.

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

describe("the pass that keeps the copy of the entries searched across the packs", () => {
  it("copies a pack whose branch came to an index no write copied, and drops it all where nothing is searched", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "info" },
      { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
    );
    const database = testDatabase.database;
    // Indexed before its default branch pointed at it, as a branch moved back to a commit
    // indexed before is: the write copied nothing.
    const pack = await makeSnapshot(database, {
      visibility: "public",
      served: true,
      files: [{ path: "docs/guide.md", text: "# Guide\n\nHow the pack is read.\n" }],
    });
    expect((await listSearchablePacks(database)).map((each) => each.snapshotId)).toEqual([
      pack.scope.snapshotId,
    ]);

    expect(await copyHubEntries({ database, logger, hub: true })).toEqual({
      dropped: 0,
      copied: 1,
      left: 0,
    });
    expect(lines.at(-1)).toMatchObject({
      msg: "the entries of the search across packs were copied",
      copied: 1,
    });
    // A pass with nothing to do says nothing.
    const said = lines.length;
    expect(await copyHubEntries({ database, logger, hub: true })).toEqual({
      dropped: 0,
      copied: 0,
      left: 0,
    });
    expect(lines).toHaveLength(said);

    // Turned off, the deployment keeps no copy; turned on again, the pass makes it again.
    expect(await copyHubEntries({ database, logger, hub: false })).toEqual({
      dropped: 1,
      copied: 0,
      left: 0,
    });
    expect(await copyHubEntries({ database, logger, hub: false })).toMatchObject({ dropped: 0 });
    expect(await copyHubEntries({ database, logger, hub: true })).toMatchObject({ copied: 1 });
  });
});
