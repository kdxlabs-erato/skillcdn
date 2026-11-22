import { compactSummary, serializedResultBytes } from "./response-budget.js";
import type { FileReference, FileResult, SkillResult } from "./results.js";

// What one answer shows of a skill and of a page of a file, whichever way it reaches an agent: a
// tool result over MCP or the output of a command (ADR-0124). The text an agent has to read, the
// rules, the instructions and the included files, or the page of the file, is kept whole. The
// lists beside it are bounded in bytes, so that an answer stays within what carries it
// (response-budget.ts) whatever a skill lists, and what was shortened is named.

/** What the lists of a skill's supporting files and of its references may take of the first page. */
const SKILL_FILES_BYTES = 3_072;
const SKILL_REFERENCES_BYTES = 2_048;
/** The room for the paths of the references a skill's first page does not resolve. */
const SKILL_UNLISTED_REFERENCES_BYTES = 1_024;
/** How many links of a page a file read lists: each a file, or a section of one with what reads it (ADR-0082). */
const FILE_REFERENCES = 12;

/** Whether {@link compactSummary} at `length` leaves something of the text out. */
const isLongerThan = (text: string, length: number): boolean =>
  text.replaceAll(/\s+/g, " ").trim().length > length;

function uniqueReferences(references: readonly FileReference[]): FileReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.path)) return false;
    seen.add(reference.path);
    return true;
  });
}

/** The longest prefix of `items` that stays within `bytes` once serialized, at most `maximum` long. */
function briefList<T>(items: readonly T[], maximum: number, bytes: number): T[] {
  const result: T[] = [];
  for (const item of items.slice(0, maximum)) {
    if (serializedResultBytes([...result, item]) > bytes) break;
    result.push(item);
  }
  return result;
}

/**
 * A page of a skill as one answer shows it. The required text is paged by the reader and kept
 * whole; the optional lists are bounded in bytes on the first page and left off a continuation:
 * a page after the first names the skill and its source and says none of its other facts again.
 */
export function skillShown(result: SkillResult, continuation = false): SkillResult {
  const references = uniqueReferences(result.references ?? []);
  const shownReferences = continuation ? [] : briefList(references, 5, SKILL_REFERENCES_BYTES);
  const shownFiles = continuation
    ? []
    : briefList(result.files, result.files.length, SKILL_FILES_BYTES);
  const blockingWarnings = result.warnings.filter((warning) =>
    /^(Applicable rules unavailable|Required file unavailable)/.test(warning),
  );
  const orderedWarnings = [
    ...blockingWarnings,
    ...result.warnings.filter((warning) => !blockingWarnings.includes(warning)),
  ];
  const shownWarnings = orderedWarnings.slice(0, 3).map((warning) => compactSummary(warning, 240));
  const description = continuation ? "" : compactSummary(result.description, 360);
  const metadata: Record<string, string> = Object.create(null);
  if (!continuation) {
    for (const [key, value] of Object.entries(result.metadata).slice(0, 8)) {
      const candidate = { ...metadata, [key]: value };
      if (serializedResultBytes(candidate) > 1_024) break;
      metadata[key] = value;
    }
  }
  // What the first page shortens is named, so that a reader knows whether what it needs is
  // among it: the description, the metadata, the warnings.
  const entries = Object.keys(result.metadata).length;
  const abbreviated = continuation
    ? []
    : [
        isLongerThan(result.description, 360) ? "the description" : undefined,
        Object.keys(metadata).length < entries
          ? `the metadata (${Object.keys(metadata).length} of ${entries} entries)`
          : undefined,
        result.warnings.length > 3
          ? `the warnings (3 of ${result.warnings.length})`
          : orderedWarnings.some((warning) => isLongerThan(warning, 240))
            ? "the warnings (shortened)"
            : undefined,
      ].filter((part) => part !== undefined);
  // The references beyond the ones resolved are named by the file each points to, which costs
  // little and tells the reader what else the skill leans on.
  const unlisted = continuation ? [] : references.slice(shownReferences.length);
  const unlistedPaths = briefList(
    unlisted.map((reference) => reference.path),
    unlisted.length,
    SKILL_UNLISTED_REFERENCES_BYTES,
  );
  return {
    ...result,
    description,
    license: continuation ? undefined : result.license,
    compatibility: continuation ? undefined : result.compatibility,
    allowedTools: continuation ? undefined : result.allowedTools,
    metadata,
    detailsTruncated: abbreviated.length > 0,
    ...(abbreviated.length > 0 ? { detailsAbbreviated: abbreviated } : {}),
    files: shownFiles,
    filesTruncated:
      !continuation && (result.filesTruncated || result.files.length > shownFiles.length),
    references: shownReferences,
    // Said once, with the other lists of the first page.
    packReferences: continuation ? undefined : result.packReferences,
    referencesTruncated: unlisted.length > 0,
    ...(unlisted.length > 0
      ? {
          referencesUnlisted: {
            paths: unlistedPaths,
            more: unlisted.length - unlistedPaths.length,
          },
        }
      : {}),
    included: result.included.filter((file) => file.content !== ""),
    warnings: shownWarnings,
    // The license line is written from the serving decision. A skill that is only described
    // keeps it on every answer: it is why nothing else follows.
    serving: continuation && result.serving?.full === true ? undefined : result.serving,
  };
}

/** A page of a file as one answer shows it: its text whole, and up to twelve of its links, each once. */
export function fileShown(result: FileResult): FileResult {
  // A link is listed once: the same destination written twice in a page is one thing to follow.
  const seen = new Set<string>();
  const references = (result.references ?? []).filter((reference) => {
    if (seen.has(reference.href)) return false;
    seen.add(reference.href);
    return true;
  });
  const shownReferences = briefList(references, FILE_REFERENCES, SKILL_REFERENCES_BYTES);
  const more = references.length - shownReferences.length;
  return {
    ...result,
    references: shownReferences,
    referencesTruncated: more > 0,
    ...(more > 0 ? { referencesMore: more } : {}),
  };
}
