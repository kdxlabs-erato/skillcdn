import {
  type BrowseResult,
  compactSummary,
  contextPage,
  type FileResult,
  type FindResult,
  fileShown,
  type IndexDiagnostic,
  MCP_RESULT_MAX_BYTES,
  renderBrowseResult,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
  type SkillResult,
  serializedResultBytes,
  skillShown,
} from "@skillcdn/core";

/**
 * A tool result is one text block written for the model, and nothing else (ADR-0034): a client
 * that passes only `structuredContent` to its model would drop the text, and a second copy of the
 * content would spend the page twice.
 */
export interface ToolReply {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const reply = (text: string): ToolReply => ({ content: [{ type: "text", text }] });

export const problem = (text: string): ToolReply => ({
  // JSON can expand a single control character to six bytes.
  content: [{ type: "text", text: contextPage(text, 0, 3_072).content }],
  isError: true,
});

export const fitsReply = (result: ToolReply): boolean =>
  serializedResultBytes(result) <= MCP_RESULT_MAX_BYTES;

const diagnosticsOf = (diagnostics: readonly IndexDiagnostic[]) => ({
  diagnostics: diagnostics.slice(0, 3).map((diagnostic) => ({
    ...diagnostic,
    message: compactSummary(diagnostic.message, 180),
  })),
  diagnosticsTotal: diagnostics.length,
});

export function browseReply(result: BrowseResult): ToolReply {
  const data: BrowseResult = {
    ...result,
    ...diagnosticsOf(result.diagnostics ?? []),
    overview:
      result.overview === undefined
        ? undefined
        : {
            ...result.overview,
            title: compactSummary(result.overview.title ?? "", 100),
            description: compactSummary(result.overview.description ?? "", 240),
          },
    ...(result.outline === undefined
      ? {}
      : {
          outline: {
            ...result.outline,
            headings: result.outline.headings.map((heading) => ({
              ...heading,
              text: compactSummary(heading.text, 100),
            })),
          },
        }),
    entries: result.entries.map((entry) => ({
      ...entry,
      name: entry.name === null ? null : compactSummary(entry.name, 100),
      description: entry.description === null ? null : compactSummary(entry.description, 240),
    })),
  };
  return reply(renderBrowseResult(data));
}

/** How many sections of one document a search page names, and how long an excerpt may be. */
const SEARCH_SECTIONS = 2;
const SEARCH_EXCERPT_LENGTH = 200;

export function searchReply(result: FindResult): ToolReply {
  const data: FindResult = {
    ...result,
    ...diagnosticsOf(result.diagnostics),
    items: result.items.map((item) =>
      item.kind === "skill"
        ? {
            ...item,
            description: compactSummary(item.description, 360),
            files: item.files.slice(0, 2).map((file) => ({
              ...file,
              title: file.title === undefined ? undefined : compactSummary(file.title, 100),
              summary: undefined,
            })),
            moreFiles: item.moreFiles + Math.max(0, item.files.length - 2),
          }
        : {
            ...item,
            title: item.title === undefined ? undefined : compactSummary(item.title, 100),
            summary: item.summary === undefined ? undefined : compactSummary(item.summary, 240),
            ...(item.sections === undefined
              ? {}
              : {
                  sections: item.sections.slice(0, SEARCH_SECTIONS).map((section) => ({
                    ...section,
                    heading: section.heading.map((text) => compactSummary(text, 80)),
                    excerpt:
                      section.excerpt === undefined
                        ? undefined
                        : compactSummary(section.excerpt, SEARCH_EXCERPT_LENGTH),
                  })),
                }),
          },
    ),
  };
  return reply(renderFindResult(data));
}

/**
 * A page of a skill as the tool answers it: what one answer shows of it, the required text whole
 * and the lists bounded ({@link skillShown}), in the words of the tools.
 */
export function skillReply(result: SkillResult, continuation = false): ToolReply {
  return reply(renderSkillResult(skillShown(result, continuation)));
}

export function fileReply(result: FileResult): ToolReply {
  return reply(renderFileResult(fileShown(result)));
}
