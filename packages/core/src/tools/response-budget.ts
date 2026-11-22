import { utf8Length } from "../search/lexemes.js";

// What one answer to an agent may weigh, by the way it reaches the agent (ADR-0124). A client
// bounds what it gives its model of one tool result, and a host what it shows of one command's
// output; past the bound they cut without a word, the head kept and the rest saved to a file, or
// the head and the tail kept and the middle dropped. So an answer is made to fit before it is
// sent, and says how to read on. Every bound here is counted in bytes of UTF-8, as the clients
// and the hosts measured count theirs: a bound counted in characters lets text of three bytes a
// character through at three times the size.

/** Bounds the complete serialized MCP result: the text written for the model, and its envelope. */
export const MCP_RESULT_MAX_BYTES = 24 * 1024;
/**
 * Bounds what one read prints for an agent that runs a command: the UTF-8 bytes of the whole
 * output. Below the least bound of the hosts measured (2026-11-22): one shows an output of up to
 * 30,000 bytes whole and of a longer one its first two kilobytes, another keeps the head and the
 * tail of one over 40,000 bytes.
 */
export const COMMAND_OUTPUT_MAX_BYTES = 28_000;
export const BROWSE_DESCRIPTION_MAX_LENGTH = 240;
export const SEARCH_DESCRIPTION_MAX_LENGTH = 360;

/** Exact UTF-8 size after JSON escaping; callers pass a serializable tool result. */
export function serializedResultBytes(value: object): number {
  return utf8Length(JSON.stringify(value));
}

/**
 * Whether a text is one a command prints for an agent in one read
 * ({@link COMMAND_OUTPUT_MAX_BYTES}): the whole of what the command writes, its last line too.
 */
export function fitsCommandOutput(text: string): boolean {
  return utf8Length(text) <= COMMAND_OUTPUT_MAX_BYTES;
}

/** Discovery summaries are single-line hints, never a replacement for source content. */
export function compactSummary(text: string, length: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  if (length < 1) return "";
  let end = length - 1;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}…`;
}
