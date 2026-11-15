import { type Database, dropHubEntries, type HubCopying, syncHubEntries } from "@skillcdn/db";
import type { Logger } from "../logger.js";

// The copy of the entries the search across packs reads its words in (ADR-0104). An index
// written where that search covers it is copied with it; this pass, every minute, follows what
// writes no index: a default branch moved back to a commit indexed before, a repository that is
// public again, an index written by a build before this one, the snapshots a search covers no
// longer, and on the day a deployment is given the copy, everything it searches. Until a snapshot
// is copied, the search reads its entries as before. A deployment that does not search across its
// packs keeps no copy: the pass drops what one kept before.

export interface HubEntriesDependencies {
  readonly database: Database;
  readonly logger: Logger;
  /** Whether the deployment searches across its packs (`HUB_SEARCH`). */
  readonly hub: boolean;
  readonly limit?: number | undefined;
}

export async function copyHubEntries(deps: HubEntriesDependencies): Promise<HubCopying> {
  const done = deps.hub
    ? await syncHubEntries(deps.database, deps.limit)
    : { dropped: await dropHubEntries(deps.database), copied: 0, left: 0 };
  if (done.dropped > 0 || done.copied > 0 || done.left > 0) {
    deps.logger.info({ ...done }, "the entries of the search across packs were copied");
  }
  return done;
}
