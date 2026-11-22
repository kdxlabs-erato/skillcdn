/** A context fragment bounded by UTF-8 bytes, with UTF-16 offsets for continuation. */
export function contextPage(
  text: string,
  offset: number,
  budget: number,
): {
  readonly content: string;
  readonly bytes: number;
  readonly more: boolean;
} {
  let end = offset;
  let bytes = 0;
  while (end < text.length) {
    const point = text.codePointAt(end);
    if (point === undefined) break;
    const size = utf8Size(point);
    if (bytes + size > budget) break;
    bytes += size;
    end += point > 0xffff ? 2 : 1;
  }
  return { content: text.slice(offset, end), bytes, more: end < text.length };
}

const utf8Size = (point: number): number =>
  point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;

/**
 * How far before the bytes run out a page may end, to end between two blocks of the text and not
 * inside one: the length of a table or of an example of code.
 */
const BLOCK_REACH = 4_096;
/** How far before the bytes run out a page may end, to end after a line: a long paragraph's worth. */
const LINE_REACH = 2_048;
/** How far before the bytes run out a page without such a line may end, to end between two words. */
const WORD_REACH = 256;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** A line that ends in a colon announces what the next lines hold: a list, an example, a table. */
const ANNOUNCES = /[:：][*_]*[ \t]*$/;

/** Where the reading of a Markdown text stands after a line: what a page that ends there leaves open. */
interface Blocks {
  /** The fence of the code block the line is in. */
  fence: { readonly mark: string; readonly length: number } | undefined;
  /** The table the line is in: where its head begins, and where its rows do. */
  table: { readonly head: number; readonly rows: number } | undefined;
  /** What the last line with text was: a heading, a line that announces what follows, or neither. */
  last: "heading" | "announcement" | "text";
}

function lineAt(text: string, start: number): { readonly line: string; readonly end: number } {
  const stop = text.indexOf("\n", start);
  const line = text.slice(start, stop === -1 ? text.length : stop);
  return {
    line: line.endsWith("\r") ? line.slice(0, -1) : line,
    end: stop === -1 ? text.length : stop + 1,
  };
}

/** Reads the line that begins at `start` and ends before `end` into `state`. */
function readLine(state: Blocks, text: string, start: number, line: string, end: number): void {
  const fence = FENCE.exec(line)?.[1];
  if (state.fence !== undefined) {
    if (
      fence?.startsWith(state.fence.mark) === true &&
      fence.length >= state.fence.length &&
      line.trim() === fence
    ) {
      state.fence = undefined;
    }
    state.last = "text";
    return;
  }
  if (fence !== undefined) {
    state.fence = { mark: fence.charAt(0), length: fence.length };
    state.table = undefined;
    state.last = "text";
    return;
  }
  const blank = line.trim().length === 0;
  if (state.table !== undefined && (blank || HEADING.test(line))) state.table = undefined;
  if (state.table === undefined && !blank && line.includes("|") && end < text.length) {
    const next = lineAt(text, end);
    if (next.line.includes("|") && DELIMITER_ROW.test(next.line)) {
      state.table = { head: start, rows: next.end };
    }
  }
  if (blank) return;
  state.last = HEADING.test(line)
    ? "heading"
    : state.table === undefined && ANNOUNCES.test(line)
      ? "announcement"
      : "text";
}

/** Whether the line that begins at `start` is one more row of a table the line before it is in. */
function continuesTable(text: string, start: number): boolean {
  if (start >= text.length) return false;
  const { line } = lineAt(text, start);
  return line.trim().length > 0 && !HEADING.test(line) && !FENCE.test(line);
}

/**
 * The last line end after `offset`, within `reach` characters of `hard`, where a reader of a
 * Markdown text can stop: outside a code block and a table, and not right after a heading or a
 * line that announces what follows. `undefined` when there is none.
 */
function lastBlockEnd(
  text: string,
  offset: number,
  hard: number,
  reach: number,
): number | undefined {
  const state: Blocks = { fence: undefined, table: undefined, last: "text" };
  let best: number | undefined;
  let start = 0;
  while (start < hard) {
    const { line, end } = lineAt(text, start);
    // A line the bytes cut is not a line end of the page.
    if (end > hard || text[end - 1] !== "\n") break;
    readLine(state, text, start, line, end);
    if (
      end > offset &&
      hard - end <= reach &&
      state.fence === undefined &&
      state.last === "text" &&
      !(state.table !== undefined && continuesTable(text, end))
    ) {
      best = end;
    }
    start = end;
  }
  return best;
}

/**
 * The head of the table that `offset` stands inside, where a page of a Markdown text begins at
 * a row of a table whose first lines the page before had: the row of names and the row under
 * it, to be said again above the rows that follow. `undefined` anywhere else.
 */
export function tableHeadAt(text: string, offset: number): string | undefined {
  if (offset <= 0 || offset >= text.length || text[offset - 1] !== "\n") return undefined;
  const state: Blocks = { fence: undefined, table: undefined, last: "text" };
  let start = 0;
  while (start < offset) {
    const { line, end } = lineAt(text, start);
    readLine(state, text, start, line, end);
    start = end;
  }
  if (state.table === undefined || state.table.rows > offset || !continuesTable(text, offset)) {
    return undefined;
  }
  return text.slice(state.table.head, state.table.rows);
}

/**
 * A page of a context made of several texts read one after another, a skill's rules, its body and
 * the files it includes: what the page holds of each, from `start` characters into them all and
 * within `budget` bytes, each text that is cut ended by {@link contextLinesPage}. A text the page
 * has passed or has not reached is empty in it, and `truncated` where it goes on or is still to
 * come. The next page begins `consumed` characters further.
 */
export function pageOfContext(
  texts: readonly string[],
  start: number,
  budget: number,
): {
  readonly parts: readonly { readonly content: string; readonly truncated: boolean }[];
  readonly consumed: number;
  /** The length of the whole context, in characters. */
  readonly total: number;
  /**
   * Where the page begins at a row of a table whose first lines the page before had, those
   * lines ({@link tableHeadAt}): the page begins inside one text at most, the one `start` is in.
   */
  readonly tableHead: string | undefined;
} {
  let skip = start;
  let remaining = budget;
  let consumed = 0;
  let total = 0;
  let tableHead: string | undefined;
  const parts = texts.map((text) => {
    total += text.length;
    if (skip >= text.length) {
      skip -= text.length;
      return { content: "", truncated: false };
    }
    const offset = skip;
    skip = 0;
    if (remaining <= 0) return { content: "", truncated: text.length > 0 };
    // A text that begins late on a page with no place to stop in reach begins the next.
    const part = contextLinesPage(text, offset, remaining, { mayBeEmpty: consumed > 0 });
    if (offset > 0 && part.content.length > 0) tableHead = tableHeadAt(text, offset);
    // A deferred character must precede every later text on the next page.
    remaining = part.more ? 0 : remaining - part.bytes;
    consumed += part.content.length;
    return { content: part.content, truncated: part.more };
  });
  return { parts, consumed, total, tableHead };
}

/**
 * In how many pages of `budget` bytes a context is read from its first character to its last:
 * what {@link pageOfContext} cuts it into, counted. At least one, for a context of nothing.
 */
export function countContextPages(texts: readonly string[], budget: number): number {
  let pages = 0;
  let start = 0;
  for (;;) {
    const page = pageOfContext(texts, start, budget);
    pages += 1;
    start += page.consumed;
    // A page that holds nothing cannot be read on from: counted, and the last.
    if (start >= page.total || page.consumed === 0) return pages;
  }
}

/**
 * A page of text to be read on: {@link contextPage}, ended where a reader can stop. Where the text
 * goes on after the page, the page ends between two blocks of Markdown when it can
 * ({@link lastBlockEnd}) within {@link BLOCK_REACH} characters of where the bytes run out and no
 * further back than half of what it could hold; else after its last line end within
 * {@link LINE_REACH}, else after its last space within {@link WORD_REACH}, else where the bytes
 * run out. The next page begins where this one ends, so the pages are the text and nothing of it
 * twice.
 *
 * With `mayBeEmpty`, for a text that begins on a page that already holds something: when no such
 * place is in what the page could hold of it, and that is no more than {@link BLOCK_REACH}, the
 * page takes nothing of the text, and the next page begins with it.
 */
export function contextLinesPage(
  text: string,
  offset: number,
  budget: number,
  options: { readonly mayBeEmpty?: boolean } = {},
): {
  readonly content: string;
  readonly bytes: number;
  readonly more: boolean;
} {
  const page = contextPage(text, offset, budget);
  if (!page.more) return page;
  const length = page.content.length;
  const mayBeEmpty = options.mayBeEmpty === true && length <= BLOCK_REACH;
  const block = lastBlockEnd(
    text,
    offset,
    offset + length,
    mayBeEmpty ? length : Math.min(BLOCK_REACH, length >> 1),
  );
  const line = page.content.lastIndexOf("\n") + 1;
  const space = page.content.lastIndexOf(" ") + 1;
  const end =
    block !== undefined
      ? block - offset
      : mayBeEmpty
        ? 0
        : line > 0 && length - line <= LINE_REACH
          ? line
          : space > 0 && length - space <= WORD_REACH
            ? space
            : length;
  if (end === length) return page;
  let bytes = 0;
  for (const character of page.content.slice(0, end)) {
    bytes += utf8Size(character.codePointAt(0) ?? 0);
  }
  return { content: page.content.slice(0, end), bytes, more: true };
}
