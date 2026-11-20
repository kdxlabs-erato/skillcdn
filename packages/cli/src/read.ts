import {
  BROWSE_MAX_LIMIT,
  browseResultOf,
  catalogStateOf,
  DATA_CODE_MAX_LIMIT,
  DATA_ROWS_MAX_LIMIT,
  directoryResultOf,
  FIND_MAX_LIMIT,
  type FileResult,
  type FindItem,
  type FindResult,
  fileResultOf,
  findResultOf,
  joinSkillPages,
  type MountSummary,
  mountSummaryOf,
  READ_FILE_MAX_LIMIT,
  renderBrowseResult,
  renderDiagnostics,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  rowsCsv,
  type SkillResult,
  skillOutcome,
  skillResultOf,
  type ToolWords,
} from "@skillcdn/core";
import { type CodePage, type DataQuery, type Pack, PackError, type RowsPage } from "./pack.js";

// The reads of a pack as the command prints them (ADR-0110): what is asked of the pack, page by
// page, and the text an agent is given or the JSON of the API, for the command's arguments as for
// another program's. A program with commands of its own (the reference console) hands in its pack
// and its words and prints what comes back, so that the same read prints the same text under
// either command. What the pack does not have, or refuses, is a PackError; what was not asked
// right is a ReadMisuse; printing, files and exit codes are the caller's.

/** A read that was not asked right: a number out of its range, a pattern that does not parse. */
export class ReadMisuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadMisuse";
  }
}

/** How the results name the reads, so that an agent is told the command and not a tool. */
export const COMMAND_WORDS: ToolWords = {
  browse: "skillcdn browse",
  search: "skillcdn find",
  load: "skillcdn skill",
  read: "skillcdn file",
};

/**
 * The most characters one read prints for an agent, where it chooses (ADR-0108): below what the
 * hosts that run an agent's commands show it whole, the least of them thirty thousand. A skill
 * longer than this is printed in parts, each saying how to read the next.
 */
export const OUTPUT_CHARS = 28_000;
/** The characters of a file one read prints unless a limit says otherwise: within {@link OUTPUT_CHARS} with its header and links. */
export const FILE_PAGE_CHARS = 24_000;

/** How many pages of a data read, or of the listing, are joined before the read stops: far above what a pack holds. */
const MAX_DATA_PAGES = 10_000;
/** How many pages of one skill a read follows before it stops, as the client's `skillPages` does: far above what one holds. */
const MAX_SKILL_PAGES = 256;

/** A word of a command line an agent is given to run: quoted where a shell would split or expand it. */
export const shellWord = (word: string): string =>
  /^[\w@%+=:,./~-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** One read of a pack, as a command asks for it. */
export type PackRead =
  /** What a client is told on connect, then every skill and every document. */
  | { readonly read: "skills" }
  /** What a folder holds, or the outline of a file: a page. */
  | {
      readonly read: "browse";
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** What the words find: a page. */
  | {
      readonly read: "find";
      readonly words: string;
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** One skill, whole or in parts within {@link OUTPUT_CHARS} (ADR-0108). */
  | { readonly read: "skill"; readonly path: string; readonly cursor?: string | undefined }
  /** A page of a file, or what a folder holds. */
  | {
      readonly read: "file";
      readonly path: string;
      readonly offset?: number | string | undefined;
      readonly limit?: number | string | undefined;
    }
  /** Every table under a path, as data (ADR-0080): CSV, rows as JSON, or the API's JSON. */
  | {
      readonly read: "rows";
      readonly path?: string | undefined;
      readonly heading?: string | undefined;
      readonly format?: string | undefined;
    }
  /** Every fenced code block under a path, as data (ADR-0080), those `grep` matches where it is given. */
  | {
      readonly read: "code";
      readonly path?: string | undefined;
      readonly heading?: string | undefined;
      readonly grep?: string | undefined;
    };

export interface ReadOptions {
  /** The words the text names the reads by; the command's own by default. */
  readonly words?: ToolWords | undefined;
  /** The JSON of the REST API instead of the words a model is given. */
  readonly json?: boolean | undefined;
  /**
   * The command that prints the next part of a skill, for the last line of a part; by default
   * `<words.load> <path> --cursor <cursor>`, which names no pack.
   */
  readonly nextPart?: ((cursor: string) => string) | undefined;
}

export interface ReadOutput {
  /** What the read prints, or what a data read writes to a file. */
  readonly text: string;
  /**
   * For the data reads, what the text holds, as the line that says it was written puts it
   * ({@link wroteLine}): `12 rows of 2 tables`, `3 code blocks`.
   */
  readonly holds?: string | undefined;
}

/**
 * A whole number a read takes as given on a command line, or `undefined` where none was: from 0
 * for an offset, from 1 for anything else, up to `max`. Anything else is a ReadMisuse that names
 * the flag: `--limit takes an integer between 1 and 200`.
 */
export function readNumber(
  value: number | string | undefined,
  name: string,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = String(value);
  const number = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (Number.isNaN(number) || number < (name === "offset" ? 0 : 1) || number > max) {
    throw new ReadMisuse(
      `--${name} takes an integer ${name === "offset" ? "from 0" : `between 1 and ${max}`}`,
    );
  }
  return number;
}

/** What a data read says when what it made went to a file instead of the output. */
export const wroteLine = (holds: string, file: string): string => `Wrote ${holds} to ${file}.`;

const counted = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const notReady = (status: string): PackError =>
  new PackError(503, `index.${status}`, "The pack is not ready to read.");

/** Every skill and document the pack lists, page after page, as one listing. */
async function listing(pack: Pack, summary: MountSummary): Promise<FindResult> {
  const items: FindItem[] = [];
  let first: FindResult | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const body = await pack.find({ cursor, limit: FIND_MAX_LIMIT });
    if (body.status !== "ready") {
      throw notReady(body.status);
    }
    const result = findResultOf(body, summary);
    first ??= result;
    items.push(...result.items);
    if (result.nextCursor === undefined) {
      return { ...first, items, nextCursor: undefined };
    }
    // A pack that answers the page it was just asked for again would be read without end.
    if (result.nextCursor === cursor) {
      break;
    }
    cursor = result.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of its listing than one read takes.",
  );
}

/**
 * What a read says when a skill is not at a path: the exact paths that are, and the manifests
 * that could not be read, since the skill asked for may be among them.
 */
async function notFound(
  pack: Pack,
  summary: MountSummary,
  path: string,
  words: ToolWords,
): Promise<PackError> {
  let available: string[] = [];
  let diagnostics = "";
  try {
    const listed = await listing(pack, summary);
    available = listed.items.flatMap((item) =>
      item.kind === "skill" && item.path !== undefined ? [item.path] : [],
    );
    diagnostics = renderDiagnostics(listed.diagnostics, true, undefined, words) ?? "";
  } catch {
    // The list is a courtesy: the refusal stands without it.
  }
  return new PackError(
    404,
    "skill.not_found",
    `No skill at ${JSON.stringify(path)}. Use ${words.browse} or ${words.search} for its exact SKILL.md path.${available.length === 0 ? "" : ` Available: ${available.slice(0, 20).join(", ")}.`}${diagnostics.length === 0 ? "" : `\n${diagnostics}`}`,
  );
}

/**
 * A skill from `from` on, every page of its context joined, or as many of them as print within
 * `fits` where it is given (ADR-0108): the first page whatever its length, and then each that
 * keeps the part within it. A part that stops before the skill does ends incomplete, with the
 * cursor of the page it did not take.
 */
async function skillFrom(
  pack: Pack,
  summary: MountSummary,
  path: string,
  from: string | undefined,
  words: ToolWords,
  fits?: (part: SkillResult) => boolean,
): Promise<SkillResult> {
  const pages: SkillResult[] = [];
  let cursor = from;
  for (let read = 0; read < MAX_SKILL_PAGES; read += 1) {
    const body = await pack.skill(path, cursor).catch(async (error: unknown) => {
      if (error instanceof PackError && error.code === "skill.not_found") {
        throw await notFound(pack, summary, path, words);
      }
      throw error;
    });
    if (body.status !== "ready") {
      throw notReady(body.status);
    }
    const page = skillResultOf(body, summary);
    if (page === undefined) {
      throw new PackError(
        0,
        "invalid_response",
        "The pack answered a skill in an unexpected shape.",
      );
    }
    const joined = joinSkillPages([...pages, page]);
    if (joined === undefined) {
      throw new Error("a skill has at least one page");
    }
    if (fits !== undefined && pages.length > 0 && !fits(joined)) {
      const part = joinSkillPages(pages);
      if (part === undefined) {
        throw new Error("a part has at least one page");
      }
      return part;
    }
    pages.push(page);
    if (page.complete || page.nextCursor === undefined) {
      return joined;
    }
    // A pack that answers the page it was just asked for again would be read without end.
    if (page.nextCursor === cursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The skill did not complete within the pages one read takes.",
  );
}

/**
 * A part as it is printed (ADR-0113). One that is not the whole skill leaves out the included
 * files it has nothing of: those before it, and those the next parts bring. One read from a cursor
 * says the facts of the skill no second time, as a page after the first over MCP does not: the
 * description, the license and the lists of files and references were in the first part.
 */
function printed(part: SkillResult, continued: boolean): SkillResult {
  if (!continued && part.complete) {
    return part;
  }
  const included = part.included.filter((file) => file.content !== "");
  return continued
    ? {
        ...part,
        description: "",
        license: undefined,
        compatibility: undefined,
        allowedTools: undefined,
        metadata: {},
        files: [],
        filesTruncated: false,
        references: [],
        referencesTruncated: false,
        included,
      }
    : { ...part, included };
}

/**
 * A page of a file the read cut where no length was asked (ADR-0108), ended at the end of its
 * last whole line, as the reader ends a page it cuts; the next page starts after that line.
 */
function endAtLine(result: FileResult): FileResult {
  if (result.nextOffset === undefined) {
    return result;
  }
  const end = result.content.lastIndexOf("\n") + 1;
  if (end === 0 || end === result.content.length) {
    return result;
  }
  const content = result.content.slice(0, end);
  return {
    ...result,
    content,
    nextOffset: result.offset + end,
    references: result.references?.filter((reference) => content.includes(reference.href)),
  };
}

/** Every page of the tables under a path, joined. */
async function allRows(pack: Pack, query: DataQuery): Promise<RowsPage> {
  let joined: RowsPage | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const page = await pack.rows({ ...query, cursor, limit: DATA_ROWS_MAX_LIMIT });
    joined =
      joined === undefined
        ? page
        : {
            ...joined,
            tables: [...joined.tables, ...page.tables],
            rowCount: joined.rowCount + page.rowCount,
            nextCursor: page.nextCursor,
          };
    if (page.nextCursor === null) {
      return joined;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of tables than one read takes.",
  );
}

/** Every page of the code blocks under a path, joined. */
async function allCode(pack: Pack, query: DataQuery): Promise<CodePage> {
  let joined: CodePage | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_DATA_PAGES; pages += 1) {
    const page = await pack.code({ ...query, cursor, limit: DATA_CODE_MAX_LIMIT });
    joined =
      joined === undefined
        ? page
        : { ...joined, blocks: [...joined.blocks, ...page.blocks], nextCursor: page.nextCursor };
    if (page.nextCursor === null) {
      return joined;
    }
    cursor = page.nextCursor;
  }
  throw new PackError(
    0,
    "invalid_response",
    "The pack answers more pages of code than one read takes.",
  );
}

const asJson = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * Reads `pack` as the command does and says what it prints (ADR-0110): the words an agent is
 * given, or with `json` the API's JSON; for the data reads the text to print or to write to a
 * file, and what it holds. A read the pack refuses, or cannot answer, throws a PackError; one
 * that was not asked right, a ReadMisuse.
 */
export async function readPack(
  pack: Pack,
  read: PackRead,
  options: ReadOptions = {},
): Promise<ReadOutput> {
  const words = options.words ?? COMMAND_WORDS;
  const json = options.json === true;
  // The mount is asked for by the reads that print from it: where the pack is and at which
  // commit, for the text an agent is given. The API's JSON and the data reads need none of it.
  const summarized = async (): Promise<MountSummary> => mountSummaryOf(await pack.mount());
  switch (read.read) {
    case "skills": {
      const mount = await pack.mount();
      if (json) {
        return { text: asJson(mount) };
      }
      return {
        text: `${renderInstructions(catalogStateOf(mount), words)}\n\n${renderFindResult(await listing(pack, mountSummaryOf(mount)), words)}`,
      };
    }
    case "browse": {
      const limit = readNumber(read.limit, "limit", BROWSE_MAX_LIMIT);
      const summary = json ? undefined : await summarized();
      const body = await pack.browse({ path: read.path, cursor: read.cursor, limit });
      if (body.status !== "ready") {
        throw notReady(body.status);
      }
      if (summary === undefined) {
        return { text: asJson(body) };
      }
      const result = browseResultOf(body, summary);
      if (result === undefined) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answered a folder in an unexpected shape.",
        );
      }
      return { text: renderBrowseResult(result, words) };
    }
    case "find": {
      const query = read.words.trim();
      if (query.length === 0) {
        throw new ReadMisuse("Say the words to find.");
      }
      const limit = readNumber(read.limit, "limit", FIND_MAX_LIMIT);
      const summary = json ? undefined : await summarized();
      const body = await pack.find({ query, path: read.path, cursor: read.cursor, limit });
      if (body.status !== "ready") {
        throw notReady(body.status);
      }
      return {
        text:
          summary === undefined
            ? asJson(body)
            : renderFindResult(findResultOf(body, summary), words),
      };
    }
    case "skill": {
      const summary = await summarized();
      if (json) {
        const whole = await skillFrom(pack, summary, read.path, read.cursor, words);
        const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill: whole } });
        return { text: asJson("body" in outcome ? outcome.body : outcome.failure) };
      }
      // A section the part cuts continues in the next part, in the caller's word for one or ours.
      const said: ToolWords = { ...words, piece: words.piece ?? "part" };
      const continued = read.cursor !== undefined;
      const render = (part: SkillResult): string =>
        renderSkillResult(printed(part, continued), said);
      // The part ends with the line that says how to read on, which the bound counts as well.
      const nextPart =
        options.nextPart ??
        ((cursor: string) => `${words.load} ${shellWord(read.path)} --cursor ${shellWord(cursor)}`);
      const lineOf = (part: SkillResult): string =>
        part.complete || part.nextCursor === undefined
          ? ""
          : `\n\nThe skill continues. Read the next part before using it: ${nextPart(part.nextCursor)}`;
      const part = await skillFrom(
        pack,
        summary,
        read.path,
        read.cursor,
        words,
        (candidate) => render(candidate).length + lineOf(candidate).length <= OUTPUT_CHARS,
      );
      return { text: `${render(part)}${lineOf(part)}` };
    }
    case "file": {
      const asked = readNumber(read.limit, "limit", READ_FILE_MAX_LIMIT);
      // A page for an agent stays within what its host shows whole; the JSON is the API's page.
      const limit = asked ?? (json ? undefined : FILE_PAGE_CHARS);
      const offset = readNumber(read.offset, "offset", Number.MAX_SAFE_INTEGER);
      const summary = json ? undefined : await summarized();
      const body = await pack.file({ path: read.path, offset, limit });
      if (summary === undefined) {
        return { text: asJson(body) };
      }
      if (body.kind === "directory") {
        const result = directoryResultOf(body, summary);
        if (result === undefined) {
          throw new PackError(
            0,
            "invalid_response",
            "The pack answered a folder in an unexpected shape.",
          );
        }
        return { text: renderDirectoryResult(result) };
      }
      const result = fileResultOf(body, summary);
      if (result === undefined) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answered a file in an unexpected shape.",
        );
      }
      // The length asked for travels with the result, so that a range the read got in full says
      // where the file continues, as a tool result does; the body itself does not carry it. A
      // page the read cut ends at a line and says to read on.
      return {
        text: renderFileResult(
          asked === undefined ? endAtLine(result) : { ...result, requestedLength: asked },
          words,
        ),
      };
    }
    case "rows": {
      const format = read.format ?? "csv";
      if (format !== "csv" && format !== "json") {
        throw new ReadMisuse("--format takes csv or json.");
      }
      const body = await allRows(pack, { path: read.path, heading: read.heading });
      const holds = `${counted(body.rowCount, "row")} of ${counted(body.tables.length, "table")}`;
      if (json) {
        return { text: asJson(body), holds };
      }
      if (format === "json") {
        const rows = body.tables.flatMap((table) =>
          table.rows.map((row) => ({
            path: table.path,
            heading: table.heading.join(" > "),
            // In the order of the columns; a name a table has twice keeps its first cell.
            cells: table.columns.reduce<Record<string, string>>((cells, column, at) => {
              if (!Object.hasOwn(cells, column)) {
                cells[column] = row[at] ?? "";
              }
              return cells;
            }, {}),
          })),
        );
        return { text: asJson(rows), holds };
      }
      return { text: rowsCsv(body.tables), holds };
    }
    case "code": {
      let pattern: RegExp | undefined;
      if (read.grep !== undefined) {
        try {
          pattern = new RegExp(read.grep, "u");
        } catch (error) {
          throw new ReadMisuse(
            `--grep takes a regular expression: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const all = await allCode(pack, { path: read.path, heading: read.heading });
      const kept =
        pattern === undefined ? all.blocks : all.blocks.filter((block) => pattern.test(block.text));
      const holds = counted(kept.length, "code block");
      if (json) {
        return { text: asJson({ ...all, blocks: kept }), holds };
      }
      const text = kept
        .map(
          (block) =>
            `--- ${block.path}${block.heading.length === 0 ? "" : ` > ${block.heading.join(" > ")}`}${block.language.length === 0 ? "" : ` (${block.language})`} ---\n${block.text}\n`,
        )
        .join("\n");
      return { text, holds };
    }
  }
}
