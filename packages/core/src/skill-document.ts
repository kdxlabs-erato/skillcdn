/**
 * The wire form of a skill: a plain Agent Skills `SKILL.md` assembled from its sources
 * (ADR-0025). The front matter of the source is re-serialized without what SkillCDN adds, a
 * line names the files it was assembled from, then come the rules of the repository manifests
 * from the root down, the skill's own body, and the files it includes. The same text goes
 * through the skills extension and through `load_skill`, and its digest is what the listing
 * declares. Nothing in it moves with the commit: the same sources are the same bytes, so the
 * digest changes when the skill does and not when its repository does (ADR-0117).
 */

/**
 * The version of the reading rules from which the document names no commit (ADR-0117). An index
 * written under an older one digested a line with the commit in it, and is served so until it
 * is rebuilt.
 */
export const COMMITLESS_DOCUMENT_INDEX_VERSION = 20;

/** The front-matter key that holds what SkillCDN adds; it stays in the source and leaves the wire. */
export const SKILLCDN_KEY = "skillcdn";

export interface SkillRulesSection {
  readonly path: string;
  readonly body: string;
  /** True when a page ends before the body is complete. */
  readonly truncated?: boolean;
}

export interface IncludedFileSection {
  readonly path: string;
  /** `undefined` when the file is not at hand: not indexed, or over the limits. */
  readonly content: string | undefined;
  readonly truncated?: boolean;
}

export interface SkillSections {
  readonly rules: readonly SkillRulesSection[];
  readonly body: string;
  readonly included: readonly IncludedFileSection[];
  /**
   * For a page that begins at a row of a table: the first lines of that table, which the page
   * before had, said again above the first text of this one (ADR-0118).
   */
  readonly tableHead?: string | undefined;
}

/**
 * A file of the skill that the server does not serve because it is over the read limit
 * (ADR-0033): the document names it, with its size and where the bytes are at the git host, so
 * that a host that installed the skill knows what is missing and can fetch it.
 */
export interface OmittedFile {
  /** The repository-root path of the file. */
  readonly path: string;
  readonly size: number;
  /**
   * Where the bytes of the file are. In the document, an address that names the file by its
   * content, so that the line stays while the file does (ADR-0117); in the result of a read,
   * the file in the commit read.
   */
  readonly sourceUrl: string;
  /** The media type to ask `sourceUrl` for, where it answers the bytes only when asked. */
  readonly accept?: string | undefined;
}

export interface SkillDocumentInput extends SkillSections {
  /**
   * The parsed front matter of the source, as the failsafe parser returns it: strings,
   * sequences and mappings, in the author's order.
   */
  readonly frontMatter: ReadonlyMap<string, unknown>;
  /** The source files, in the order they are used. */
  readonly sources: readonly string[];
  /**
   * The commit, only for an index written before {@link COMMITLESS_DOCUMENT_INDEX_VERSION},
   * whose digest covers a line that names it.
   */
  readonly commit?: string | undefined;
  /** The files of the skill left out for their size, in path order. */
  readonly omitted?: readonly OmittedFile[];
}

const RESERVED_PLAIN_KEYS = new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]);
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A YAML double-quoted scalar; JSON's escapes are a subset of YAML's. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

function keyOf(key: string): string {
  return PLAIN_KEY.test(key) && !RESERVED_PLAIN_KEYS.has(key.toLowerCase()) ? key : quoted(key);
}

/** One YAML node at `indent`, every scalar quoted, so that no reader can mistake its type. */
function yamlLines(value: unknown, indent: string): string[] {
  if (value instanceof Map) {
    if (value.size === 0) return [`${indent}{}`];
    return [...value.entries()].flatMap(([key, entry]) => {
      const nested = yamlLines(entry, `${indent}  `);
      return isScalar(entry)
        ? [`${indent}${keyOf(String(key))}: ${nested[0]?.trim() ?? '""'}`]
        : [`${indent}${keyOf(String(key))}:`, ...nested];
    });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      const nested = yamlLines(item, `${indent}  `);
      return isScalar(item)
        ? [`${indent}- ${nested[0]?.trim() ?? '""'}`]
        : [`${indent}-`, ...nested];
    });
  }
  return [`${indent}${quoted(value === undefined || value === null ? "" : String(value))}`];
}

function isScalar(value: unknown): boolean {
  return !(value instanceof Map) && !Array.isArray(value);
}

/** The front matter as it is served: the author's fields, quoted, without SkillCDN's own key. */
export function serializeFrontMatter(frontMatter: ReadonlyMap<string, unknown>): string {
  const served = new Map([...frontMatter].filter(([key]) => key !== SKILLCDN_KEY));
  return yamlLines(served, "").join("\n");
}

/** The served front matter as data, for a listing to declare what a reader will parse. */
export function frontMatterObject(
  frontMatter: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  const toData = (value: unknown): unknown => {
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, entry]) => [String(key), toData(entry)]),
      );
    }
    if (Array.isArray(value)) return value.map(toData);
    return value === undefined || value === null ? "" : String(value);
  };
  const data = toData(new Map([...frontMatter].filter(([key]) => key !== SKILLCDN_KEY)));
  return data as Record<string, unknown>;
}

function listOfPaths(paths: readonly string[]): string {
  const named = paths.map((path) => `\`${path}\``);
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The sections of a skill as a model reads them, in the order the author meant them to be read:
 * the rules that hold for the skill, then its instructions, then the files it needs on every run.
 * `continuation` names the tool whose next page completes a section that was cut, or with `piece`
 * what the next read of the skill is called instead.
 */
export function renderSkillSections(
  sections: SkillSections,
  continuation?: {
    readonly tool: string;
    readonly reader: string;
    readonly piece?: string | undefined;
  },
): string {
  const parts: string[] = [];
  const continues =
    continuation === undefined
      ? ""
      : `\n(Continues in the next ${continuation.piece ?? `${continuation.tool} page`}.)`;
  // The first text of the page is the one the page before cut: rows without the head of their
  // table are read under the wrong names, or under none.
  let tableHead = sections.tableHead;
  const resumed = (text: string): string => {
    if (tableHead === undefined || text.length === 0) return text;
    const head = tableHead;
    tableHead = undefined;
    return `(The table goes on from the ${continuation?.piece ?? "page"} before; its first lines again:)\n${head}${text}`;
  };
  for (const rule of sections.rules) {
    const cut = rule.truncated === true ? continues : "";
    parts.push(`--- applicable rules: ${rule.path} ---\n${resumed(rule.body)}${cut}`);
  }
  if (sections.body.length > 0) {
    parts.push(`--- instructions ---\n${resumed(sections.body)}`);
  }
  for (const file of sections.included) {
    const header = `--- included file: ${file.path} ---`;
    if (file.content === undefined) {
      parts.push(
        `${header}\n(Not at hand here${continuation === undefined ? "" : `; ${continuation.reader} has it`}.)`,
      );
      continue;
    }
    const cut = file.truncated === true ? continues : "";
    parts.push(`${header}\n${resumed(file.content)}${cut}`);
  }
  return parts.join("\n\n");
}

/**
 * The line that says what the document was assembled from; it opens the body of every served
 * skill. With `commit`, the line as it was while the document named one.
 */
export function provenanceLine(sources: readonly string[], commit?: string): string {
  const at = commit === undefined ? "" : ` at commit \`${commit}\``;
  return `> Assembled by SkillCDN from ${listOfPaths(sources)}${at}.`;
}

/**
 * The lines that name the files left out of the skill, one per file, right after the provenance
 * line: what is missing, how large it is, and where to fetch it from.
 */
export function omittedLines(omitted: readonly OmittedFile[]): string[] {
  return omitted.map(
    (file) =>
      `> Not included, over this server's file size limit: \`${file.path}\` (${file.size} bytes); fetch it from ${file.sourceUrl}${file.accept === undefined ? "" : ` with the header \`Accept: ${file.accept}\``}`,
  );
}

/** The complete document, ending in one line break. Deterministic: the same input, the same bytes. */
export function assembleSkillDocument(input: SkillDocumentInput): string {
  const sections = renderSkillSections(input);
  const head = [provenanceLine(input.sources, input.commit), ...omittedLines(input.omitted ?? [])];
  return `---\n${serializeFrontMatter(input.frontMatter)}\n---\n${head.join("\n")}${sections.length === 0 ? "" : `\n\n${sections}`}\n`;
}
