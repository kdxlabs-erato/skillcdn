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

/** How far before the bytes run out a page may end, to end after a line: a long paragraph's worth. */
const LINE_REACH = 2_048;
/** How far before the bytes run out a page without such a line may end, to end between two words. */
const WORD_REACH = 256;

/**
 * A page of text to be read on: {@link contextPage}, ended where a reader can stop. Where the text
 * goes on after the page, the page ends after its last line end when one is within
 * {@link LINE_REACH} characters of where the bytes run out, else after its last space within
 * {@link WORD_REACH}, else where the bytes run out, as before. The next page begins where this
 * one ends, so the pages are the text and nothing of it twice.
 */
export function contextLinesPage(
  text: string,
  offset: number,
  budget: number,
): {
  readonly content: string;
  readonly bytes: number;
  readonly more: boolean;
} {
  const page = contextPage(text, offset, budget);
  if (!page.more) return page;
  const length = page.content.length;
  const line = page.content.lastIndexOf("\n") + 1;
  const space = page.content.lastIndexOf(" ") + 1;
  const end =
    line > 0 && length - line <= LINE_REACH
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
