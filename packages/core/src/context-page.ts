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
 * How many bytes before they run out a page may end, to end between two blocks of the text and
 * not inside one: a quarter of a page of a skill, the length of a table or of an example of code.
 * Bytes, as the page itself is counted, so that a page gives up the same share of itself in every
 * script: characters of three bytes each fill a page three times as fast.
 */
export const CONTEXT_BLOCK_REACH = 4_096;
/** How many bytes before they run out a line longer than a page is cut, to be cut between two words. */
const WORD_REACH = 256;
/** How many characters back a page looks for one that does not join the character before it. */
const JOINED_BACK = 32;

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
 * The earliest place in `text` that is no more than `bytes` bytes before `hard`, and not before
 * `offset`: how far back a reach of that many bytes goes.
 */
function floorWithin(text: string, offset: number, hard: number, bytes: number): number {
  let floor = hard;
  let counted = 0;
  while (floor > offset) {
    const start = previousCharacter(text, offset, floor);
    const size = utf8Size(text.codePointAt(start) ?? 0);
    if (counted + size > bytes) break;
    counted += size;
    floor = start;
  }
  return floor;
}

/** Where the character that ends before `end` begins: two units back for a pair of surrogates. */
function previousCharacter(text: string, offset: number, end: number): number {
  const low = text.charCodeAt(end - 1);
  const high = text.charCodeAt(end - 2);
  return end - 2 >= offset && low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff
    ? end - 2
    : end - 1;
}

/**
 * The last line end after `offset` and no earlier than `floor`, before `hard`, where a reader of
 * a Markdown text can stop: outside a code block and a table, and not right after a heading or a
 * line that announces what follows. `undefined` when there is none.
 */
function lastBlockEnd(
  text: string,
  offset: number,
  hard: number,
  floor: number,
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
      end >= floor &&
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

/** Whether the line that begins at `start` is no more than `budget` bytes, its line end counted. */
function lineFits(text: string, start: number, budget: number): boolean {
  let bytes = 0;
  for (let at = start; at < text.length; ) {
    const point = text.codePointAt(at) ?? 0;
    bytes += utf8Size(point);
    if (bytes > budget) return false;
    if (point === 0x0a) return true;
    at += point > 0xffff ? 2 : 1;
  }
  return true;
}

const MARK = /^\p{M}$/u;

/**
 * Whether a character is read as part of the one before it: a combining mark, a joiner or a
 * selector of how the one before is shown, the vowel or the final consonant of a Hangul syllable
 * written in its letters, the tone of skin of an emoji.
 */
function joinsBack(point: number): boolean {
  return (
    point === 0x200d ||
    (point >= 0xfe00 && point <= 0xfe0f) ||
    (point >= 0x1160 && point <= 0x11ff) ||
    (point >= 0xd7b0 && point <= 0xd7ff) ||
    (point >= 0x1f3fb && point <= 0x1f3ff) ||
    MARK.test(String.fromCodePoint(point))
  );
}

/**
 * Where a line longer than a page is cut, at or before `hard` and after `from`, where the page
 * has the line from: after its last space within {@link WORD_REACH} bytes, else where the bytes
 * run out, a little earlier where the next character would be read as part of the last one, so
 * that what a reader sees as one character is on one page. A run of such characters longer than
 * a page looks back over is cut as it is.
 */
function wordEnd(text: string, from: number, hard: number): number {
  const space = text.lastIndexOf(" ", hard - 1) + 1;
  if (space > from && space >= floorWithin(text, from, hard, WORD_REACH)) return space;
  let end = hard;
  for (let back = 0; back < JOINED_BACK && end > from && end < text.length; back += 1) {
    if (!joinsBack(text.codePointAt(end) ?? 0) && text.charCodeAt(end - 1) !== 0x200d) return end;
    end = previousCharacter(text, from, end);
  }
  return hard;
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
    const part = contextLinesPage(text, offset, remaining, {
      mayBeEmpty: consumed > 0,
      pageBytes: budget,
    });
    if (offset > 0 && part.content.length > 0) tableHead = tableHeadAt(text, offset);
    // A deferred character must precede every later text on the next page.
    remaining = part.more ? 0 : remaining - part.bytes;
    consumed += part.content.length;
    return { content: part.content, truncated: part.more };
  });
  return { parts, consumed, total, tableHead };
}

/**
 * In how many pages of `budget` bytes a context is read from `start` characters into it to its
 * last character: what {@link pageOfContext} cuts it into, counted. At least one, for a context
 * of nothing.
 */
export function countContextPages(texts: readonly string[], budget: number, start = 0): number {
  let pages = 0;
  let at = start;
  for (;;) {
    const page = pageOfContext(texts, at, budget);
    pages += 1;
    at += page.consumed;
    // A page that holds nothing cannot be read on from: counted, and the last.
    if (at >= page.total || page.consumed === 0) return pages;
  }
}

/**
 * What a page ends inside, where it does not end between two blocks: a line, a fenced code
 * block, a table that goes on with one more row, or the opening of what follows, right after a
 * heading or a line that announces it.
 */
export type ContextCut = "line" | "code" | "table" | "opening";

/**
 * What a page that ends `end` characters into a Markdown text ends inside ({@link ContextCut}).
 * `undefined` between two blocks, and at either end of the text.
 */
export function contextCutAt(text: string, end: number): ContextCut | undefined {
  if (end <= 0 || end >= text.length) return undefined;
  if (text[end - 1] !== "\n") return "line";
  const state: Blocks = { fence: undefined, table: undefined, last: "text" };
  let start = 0;
  while (start < end) {
    const read = lineAt(text, start);
    readLine(state, text, start, read.line, read.end);
    start = read.end;
  }
  if (state.fence !== undefined) return "code";
  if (state.table !== undefined && continuesTable(text, end)) return "table";
  return state.last === "text" ? undefined : "opening";
}

/**
 * Where the pages of a context end inside something ({@link ContextCut}), for whoever writes the
 * texts: the pages {@link pageOfContext} cuts the context into, and of each that ends elsewhere
 * than between two blocks or two texts, which page it is, counted from one, which of the texts it
 * ends in and how many characters into it, the line of that text the next page begins with or
 * in, counted from one, and what it ends inside.
 */
export function contextPageCuts(
  texts: readonly string[],
  budget: number,
): readonly {
  readonly page: number;
  readonly text: number;
  readonly offset: number;
  readonly line: number;
  readonly inside: ContextCut;
}[] {
  const cuts: {
    page: number;
    text: number;
    offset: number;
    line: number;
    inside: ContextCut;
  }[] = [];
  let start = 0;
  for (let page = 1; ; page += 1) {
    const { consumed, total } = pageOfContext(texts, start, budget);
    start += consumed;
    if (start >= total || consumed === 0) return cuts;
    // The text the next page begins in, and how far into it.
    let offset = start;
    for (const [at, text] of texts.entries()) {
      if (offset >= text.length) {
        offset -= text.length;
        continue;
      }
      const inside = contextCutAt(text, offset);
      if (inside !== undefined) {
        let line = 1;
        for (let found = text.indexOf("\n"); found !== -1 && found < offset; ) {
          line += 1;
          found = text.indexOf("\n", found + 1);
        }
        cuts.push({ page, text: at, offset, line, inside });
      }
      break;
    }
  }
}

/**
 * A page of text to be read on: {@link contextPage}, ended where a reader can stop. Where the
 * text goes on after the page, the page ends, in this order of what it finds:
 *
 * 1. between two blocks of Markdown ({@link lastBlockEnd}), within {@link CONTEXT_BLOCK_REACH}
 *    bytes of where the bytes run out and no further back than half of what the page could hold;
 * 2. after its last line end, however far back, when the line the bytes run out in is one a page
 *    of `pageBytes` holds whole: a line is the least a text is made of, and one cut in two is a
 *    row with half its cells or a link with half its address, which nothing said on the next
 *    page mends;
 * 3. after its last space within {@link WORD_REACH} bytes, else where the bytes run out
 *    ({@link wordEnd}): only a line longer than a page is cut so.
 *
 * The next page begins where this one ends, so the pages are the text and nothing of it twice.
 *
 * With `mayBeEmpty`, for a text that begins on a page that already holds something: the half does
 * not bound the reach, since the page is not left short by what it gives up of a text it holds
 * other text before, and a block shorter than the reach is not cut for beginning in the first
 * half of the little the page could hold. The page takes nothing of the text, and the next page
 * begins with it, when no place of 1 is in what the page could hold of it and that is no more
 * than {@link CONTEXT_BLOCK_REACH}, and when its first line does not fit what is left of the page
 * and fits a page.
 *
 * `pageBytes` is what a page holds, `budget` where none is given: what is left of a page that
 * holds other text is less.
 */
export function contextLinesPage(
  text: string,
  offset: number,
  budget: number,
  options: { readonly mayBeEmpty?: boolean; readonly pageBytes?: number } = {},
): {
  readonly content: string;
  readonly bytes: number;
  readonly more: boolean;
} {
  const page = contextPage(text, offset, budget);
  if (!page.more) return page;
  const length = page.content.length;
  const hard = offset + length;
  const late = options.mayBeEmpty === true;
  const block = lastBlockEnd(
    text,
    offset,
    hard,
    floorWithin(
      text,
      offset,
      hard,
      Math.min(CONTEXT_BLOCK_REACH, late ? page.bytes : page.bytes >> 1),
    ),
  );
  const line = page.content.lastIndexOf("\n") + 1;
  let end: number;
  if (block !== undefined) {
    end = block - offset;
  } else if (late && page.bytes <= CONTEXT_BLOCK_REACH) {
    end = 0;
  } else if ((line > 0 || late) && lineFits(text, offset + line, options.pageBytes ?? budget)) {
    end = line;
  } else {
    // The line the bytes run out in is the one that is cut, not a line before it.
    end = wordEnd(text, offset + line, hard) - offset;
  }
  if (end === length) return page;
  let bytes = 0;
  for (const character of page.content.slice(0, end)) {
    bytes += utf8Size(character.codePointAt(0) ?? 0);
  }
  return { content: page.content.slice(0, end), bytes, more: true };
}
