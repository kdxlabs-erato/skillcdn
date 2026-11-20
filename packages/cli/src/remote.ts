import {
  ApiError,
  createClient,
  type FetchLike,
  type SkillCdnClient,
  whenIndexed,
} from "@skillcdn/client";
import type { Address } from "@skillcdn/core";
import { type Pack, PackError } from "./pack.js";

// A pack at a deployment (ADR-0056): the five reads of its REST API through @skillcdn/client,
// with the token a person made for it as the bearer, waiting while a first look at a commit
// indexes it. What the API refuses is a PackError with the API's own code. A read asks for what
// it reads and nothing before it: the mount is asked for by whoever needs the mount.

export interface RemoteOptions {
  readonly url: string;
  readonly address: Address;
  readonly token: string | undefined;
  readonly fetch: FetchLike;
  readonly userAgent: string | undefined;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long a read waits for an index that is being built. */
  readonly waitMs?: number | undefined;
}

/** How long a read waits for the deployment to index a commit it sees for the first time. */
export const DEFAULT_WAIT_MS = 30_000;

/** What the API refused, as the error a read of a pack throws, with the API's own code. */
export const asPackError = (error: unknown): never => {
  if (error instanceof ApiError) {
    throw new PackError(error.status, error.code, error.message, {
      directories: error.directories,
      sourceUrl: error.sourceUrl,
    });
  }
  throw error;
};

export function openDeployment(options: RemoteOptions): Pack {
  const client: SkillCdnClient = createClient({
    baseUrl: options.url,
    fetch: options.fetch,
    token: options.token,
    userAgent: options.userAgent,
  });
  const { address } = options;
  const wait = { timeoutMs: options.waitMs ?? DEFAULT_WAIT_MS, sleep: options.sleep };
  const indexing = (answer: unknown): boolean =>
    typeof answer === "object" &&
    answer !== null &&
    "status" in answer &&
    answer.status === "indexing";
  /**
   * A read, asked at once: a pack whose index is there, which is nearly every read, costs no
   * request for its mount first. Where the deployment says it is still indexing the commit, the
   * read waits for the index and asks again.
   */
  const read = async <T>(ask: () => Promise<T>): Promise<T> => {
    try {
      const answer = await ask();
      if (!indexing(answer)) {
        return answer;
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "index.indexing")) {
        return asPackError(error);
      }
    }
    await whenIndexed(client, address, wait).catch(asPackError);
    return ask().catch(asPackError);
  };
  const notReady = (status: "indexing" | "failed", errorCode?: string): never => {
    throw new PackError(
      503,
      status === "indexing" ? "index.indexing" : "index.failed",
      status === "indexing"
        ? "The repository is being indexed. Try again shortly."
        : `The repository could not be indexed (${errorCode ?? "unknown"}). Try again later.`,
    );
  };
  return {
    address,
    source: { kind: "deployment", url: options.url },
    async mount() {
      return whenIndexed(client, address, wait).catch(asPackError);
    },
    async browse(query) {
      const body = await read(() => client.browse(address, query));
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async find(query) {
      const body = await read(() => client.find(address, query));
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async skill(path, cursor) {
      const body = await read(() => client.skill(address, { path, cursor }));
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async file(query) {
      return read(() => client.file(address, query));
    },
    async rows(query) {
      const body = await read(() => client.rows(address, query));
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
    async code(query) {
      const body = await read(() => client.code(address, query));
      return body.status === "ready"
        ? body
        : notReady(body.status, body.status === "failed" ? body.errorCode : undefined);
    },
  };
}
