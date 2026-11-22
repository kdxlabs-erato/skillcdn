import { describe, expect, it } from "vitest";
import {
  contextCutAt,
  contextLinesPage,
  contextPage,
  contextPageCuts,
  countContextPages,
  pageOfContext,
  tableHeadAt,
} from "./context-page.js";

describe("contextPage", () => {
  it("bounds mixed-language text by bytes without splitting characters", () => {
    const text = `ab${String.fromCodePoint(0xac00)}${String.fromCodePoint(0x1f642)}z`;
    expect(contextPage(text, 0, 5)).toEqual({ content: text.slice(0, 3), bytes: 5, more: true });
    expect(contextPage(text, 3, 3)).toEqual({ content: "", bytes: 0, more: true });
    expect(contextPage(text, 3, 5)).toEqual({ content: text.slice(3), bytes: 5, more: false });
  });

  it("uses replacement-character byte size for isolated surrogates", () => {
    const text = String.fromCharCode(0xd800);
    expect(contextPage(text, 0, 2)).toEqual({ content: "", bytes: 0, more: true });
    expect(contextPage(text, 0, 3)).toEqual({ content: text, bytes: 3, more: false });
  });
});

describe("contextLinesPage", () => {
  const pagesOf = (text: string, budget: number): string[] => {
    const pages: string[] = [];
    for (let offset = 0; offset < text.length; ) {
      const page = contextLinesPage(text, offset, budget);
      if (page.content.length === 0) throw new Error("a page that does not advance");
      pages.push(page.content);
      offset += page.content.length;
    }
    return pages;
  };

  it("ends a page after its last line where the text goes on", () => {
    const text = "First line of the skill.\nSecond line, which the bytes run out in.\nThird.\n";
    const page = contextLinesPage(text, 0, 40);
    expect(page).toEqual({ content: "First line of the skill.\n", bytes: 25, more: true });
    expect(contextLinesPage(text, 25, 1_000).content).toBe(text.slice(25));
    // A text that fits is the page, whatever it ends with.
    expect(contextLinesPage("No line end", 0, 100)).toEqual({
      content: "No line end",
      bytes: 11,
      more: false,
    });
  });

  it("ends between two words where no line ends near, and where the bytes run out otherwise", () => {
    const words = "collected with the tool that waits for the jobs";
    expect(contextLinesPage(words, 0, 12).content).toBe("collected ");
    const unbroken = "x".repeat(600);
    expect(contextLinesPage(unbroken, 0, 500).content).toBe("x".repeat(500));
    // A line longer than a page is cut whatever the page does: stopping before it would waste
    // the page, so the words near the end are where it stops.
    const far = `Heading\n${"word ".repeat(1_000)}`;
    const page = contextLinesPage(far, 0, 4_000);
    expect(page.content.endsWith("word ")).toBe(true);
    expect(page.content.length).toBeGreaterThan(3_900);
  });

  it("counts the bytes of what it kept, and its pages are the text", () => {
    const line = `${String.fromCodePoint(0xac00).repeat(20)} ${String.fromCodePoint(0x1f642)}\n`;
    const text = line.repeat(40);
    const page = contextLinesPage(text, 0, 300);
    // A line is 20 characters of three bytes, a space, one of four bytes and the line end: 66.
    expect(page).toEqual({ content: line.repeat(4), bytes: 264, more: true });
    for (const budget of [70, 300, 1_024]) {
      expect(pagesOf(text, budget).join("")).toBe(text);
    }
    const hostile = `${"\n".repeat(50)}${String.fromCharCode(0xd800)}${"a b".repeat(400)}`;
    expect(pagesOf(hostile, 64).join("")).toBe(hostile);
  });
});

describe("a page of Markdown (ADR-0118)", () => {
  const paragraph = (words: number): string => `${"word ".repeat(words).trim()}\n`;
  const table = (rows: number): string =>
    `| Input | Source |\n|---|---|\n${Array.from({ length: rows }, (_, row) => `| item ${row} | where item ${row} comes from |\n`).join("")}`;

  it("ends before a table the bytes would cut, not inside it", () => {
    const before = `# Inputs\n\n${paragraph(60)}\n`;
    const text = `${before}${table(20)}\nAfter the table.\n`;
    const page = contextLinesPage(text, 0, before.length + 200);
    expect(page.content).toBe(before);
    // The next page has the table whole, so nothing is said of its head.
    expect(tableHeadAt(text, before.length)).toBeUndefined();
    expect(contextLinesPage(text, before.length, 4_000).content).toBe(text.slice(before.length));
  });

  it("ends before a code block the bytes would cut, and before the line that announces it", () => {
    const before = `${paragraph(80)}\n`;
    const code = `Run:\n\n\`\`\`json\n${'{ "key": "value" }\n'.repeat(12)}\`\`\`\n`;
    const text = `${before}${code}\n${paragraph(10)}`;
    // The bytes run out inside the block: the page gives up the block and the line before it.
    expect(contextLinesPage(text, 0, before.length + 120).content).toBe(before);
    // A fence of tildes, and a longer fence that holds a shorter one, are blocks as well.
    const nested = `${before}~~~~\n\`\`\`\ninner\n\`\`\`\n${"line\n".repeat(20)}~~~~\n\nEnd.\n`;
    expect(contextLinesPage(nested, 0, before.length + 60).content).toBe(before);
  });

  it("does not end right after a heading, nor after a line that opens a list", () => {
    const before = `${paragraph(80)}\n`;
    const heading = `${before}### Phase 3: Board\n\n${paragraph(200)}`;
    expect(contextLinesPage(heading, 0, before.length + 24).content).toBe(before);
    const first = `${paragraph(80)}\n`;
    const list = `${first}Then:\n\n- one\n- two\n${paragraph(200)}`;
    expect(contextLinesPage(list, 0, first.length + 8).content).toBe(first);
    // Between two items of a list is a place to stop: a long list has no other.
    const items = `${first}Then:\n\n${"- an item of the list\n".repeat(40)}`;
    const page = contextLinesPage(items, 0, first.length + 400);
    expect(page.content.endsWith("- an item of the list\n")).toBe(true);
    expect(page.content.length).toBeGreaterThan(first.length + 300);
  });

  it("cuts a table longer than its reach after a row, and names its head for the next page", () => {
    const text = `${paragraph(20)}\n${table(400)}\nAfter.\n`;
    const page = contextLinesPage(text, 0, 8_000);
    expect(page.content.endsWith("|\n")).toBe(true);
    expect(page.content.length).toBeGreaterThan(7_000);
    expect(tableHeadAt(text, page.content.length)).toBe("| Input | Source |\n|---|---|\n");
    // Nowhere else: before the table, at its first row of names, after it, or inside a line.
    expect(tableHeadAt(text, 0)).toBeUndefined();
    expect(tableHeadAt(text, text.indexOf("| Input"))).toBeUndefined();
    expect(tableHeadAt(text, text.indexOf("After."))).toBeUndefined();
    expect(tableHeadAt(text, page.content.length + 3)).toBeUndefined();
    // A line of dashes under a paragraph is a heading, not a table.
    const setext = "Title | with a bar\n---\nBody line one.\nBody line two.\n";
    expect(tableHeadAt(setext, setext.indexOf("Body line two."))).toBeUndefined();
  });

  it("leaves a text that begins late on a page to the next page, when it has no place to stop", () => {
    const text = `${table(30)}\nAfter.\n`;
    // Alone on a page, something of it must be read.
    expect(contextLinesPage(text, 0, 300).content.length).toBeGreaterThan(0);
    // After other texts, the page ends before it.
    expect(contextLinesPage(text, 0, 300, { mayBeEmpty: true })).toEqual({
      content: "",
      bytes: 0,
      more: true,
    });
    // A text with a place to stop gives the page what comes before that place.
    const prose = `${paragraph(30)}\n${paragraph(30)}\n${paragraph(30)}`;
    const part = contextLinesPage(prose, 0, 200, { mayBeEmpty: true });
    expect(part.content).toBe(`${paragraph(30)}\n`);
  });

  it("gives up a block within its whole reach where the text begins after other text (ADR-0122)", () => {
    // What a page of a served skill did: 5,000 characters of an included file fit after the
    // skill's body, and the file's first example of code began 2,000 characters in and ran on
    // past them. Half of the 5,000 did not reach back to where the example began.
    const before = `# Build\n\n${paragraph(398)}\n`;
    const code = `\`\`\`sql\n${"  subject_id TEXT, -- the thing unlocked\n".repeat(75)}\`\`\`\n`;
    const text = `${before}${code}\n${paragraph(400)}`;
    expect(before.length).toBe(2_000);
    expect(code.length).toBeLessThan(4_096);
    expect(contextLinesPage(text, 0, 5_000, { mayBeEmpty: true }).content).toBe(before);
    // A page that begins with the text still keeps half of what it could hold of it.
    expect(contextLinesPage(text, 0, 5_000).content.length).toBeGreaterThan(2_500);

    // The same through the pages of a context: the body, then the file.
    const body = paragraph(2_000);
    const page = pageOfContext([body, text], 0, body.length + 5_000);
    expect(page.parts).toEqual([
      { content: body, truncated: false },
      { content: before, truncated: true },
    ]);
    const next = pageOfContext([body, text], page.consumed, body.length + 5_000);
    expect(next.parts[1]?.content.startsWith(code)).toBe(true);
  });

  it("gives the text whole and nothing of it twice, whatever it holds", () => {
    const text = [
      "# Skill\n\n",
      paragraph(120),
      "\n## Inputs\n\n",
      table(60),
      "\nThen:\n\n",
      "- one\n- two\n\n",
      "```sh\n",
      "echo one\n".repeat(80),
      "```\n\n",
      paragraph(300),
      "\n### Verdicts\n\n",
      table(15),
    ].join("");
    for (const budget of [256, 1_024, 4_096, 16_384]) {
      const pages: string[] = [];
      for (let offset = 0; offset < text.length; ) {
        const page = contextLinesPage(text, offset, budget);
        expect(page.content.length).toBeGreaterThan(0);
        pages.push(page.content);
        offset += page.content.length;
      }
      expect(pages.join("")).toBe(text);
    }
  });
});

describe("a page in every script, and a line whole (ADR-0123)", () => {
  const bytesOf = (text: string): number => {
    let bytes = 0;
    for (const character of text) {
      const point = character.codePointAt(0) ?? 0;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
  };
  const hangul = (count: number): string => String.fromCodePoint(0xac00).repeat(count);
  const paragraph = (words: number): string => `${"word ".repeat(words).trim()}\n`;
  const table = (rows: number): string =>
    `| Input | Source |\n|---|---|\n${Array.from({ length: rows }, (_, row) => `| item ${row} | where item ${row} comes from |\n`).join("")}`;

  it("counts its reach in bytes, so that a page gives up the same share of itself in every script", () => {
    const before = `${`${hangul(39)}\n`.repeat(60)}\n`;
    const rows = `| ${hangul(16)} | ${hangul(16)} |\n`.repeat(120);
    const text = `${before}| a | b |\n|---|---|\n${rows}\nAfter.\n`;
    // The bytes run out 6,000 bytes into the table, which is some 2,300 characters of Hangul:
    // nearer than 4,096 characters, and further than 4,096 bytes. The page keeps what it holds
    // of the table, to a row, where it once gave up a half of itself to end before the table.
    const budget = bytesOf(before) + 6_000;
    const page = contextLinesPage(text, 0, budget);
    expect(page.content.length).toBeGreaterThan(before.length);
    expect(page.content.endsWith("|\n")).toBe(true);
    expect(page.bytes).toBeGreaterThan(budget - 4_096);
    expect(tableHeadAt(text, page.content.length)).toBe("| a | b |\n|---|---|\n");
    // A table that began within the reach is still given up whole.
    expect(contextLinesPage(text, 0, bytesOf(before) + 3_000).content).toBe(before);
  });

  it("ends before a line the bytes run out in, however far back the line begins", () => {
    // A line of code of 3,000 characters, in a block too long to give up whole.
    const pair = '{ "key": "value" }\n';
    const long = `${"x".repeat(3_000)}\n`;
    const head = `\`\`\`json\n${pair.repeat(300)}`;
    const code = `${head}${long}${pair.repeat(10)}\`\`\`\n`;
    const page = contextLinesPage(code, 0, head.length + 2_500);
    expect(page.content).toBe(head);
    expect(contextLinesPage(code, head.length, head.length + 2_500).content.startsWith(long)).toBe(
      true,
    );
    // A paragraph written as one line of 5,000 characters, further back than a block is given up.
    const first = `${paragraph(100)}\n`;
    const prose = `${first}${paragraph(1_000)}\nEnd.\n`;
    expect(contextLinesPage(prose, 0, first.length + 4_500).content).toBe(first);
  });

  it("begins the next page with a line that fits a page and not what is left of this one", () => {
    const text = `${paragraph(1_600)}After.\n`;
    // 5,000 bytes are left of a page of 16,384 for a first line of 8,000.
    expect(contextLinesPage(text, 0, 5_000, { mayBeEmpty: true, pageBytes: 16_384 })).toEqual({
      content: "",
      bytes: 0,
      more: true,
    });
    const body = paragraph(2_000);
    const page = pageOfContext([body, text], 0, 16_384);
    expect(page.parts).toEqual([
      { content: body, truncated: false },
      { content: "", truncated: true },
    ]);
    const next = pageOfContext([body, text], page.consumed, 16_384);
    expect(next.parts[1]?.content).toBe(text);
    // A line no page holds is cut where the page is, between two words.
    const longer = paragraph(4_000);
    const cut = contextLinesPage(longer, 0, 5_000, { mayBeEmpty: true, pageBytes: 16_384 });
    expect(cut.content.endsWith("word ")).toBe(true);
    expect(cut.content.length).toBeGreaterThan(4_900);
    // The line that is cut is the one too long for a page: not a line before it, at a space of
    // its own, for want of a space in the long one.
    const mixed = `a short line\n${"x".repeat(600)}\n`;
    expect(contextLinesPage(mixed, 0, 500).content).toBe(`a short line\n${"x".repeat(487)}`);
  });

  it("does not part what is read as one character, where it cuts a line with no word to end at", () => {
    // A letter and the accent written after it: the bytes run out between the two.
    const accent = String.fromCodePoint(0x301);
    const accented = `${"x".repeat(498)}e${accent}${"x".repeat(200)}`;
    expect(contextLinesPage(accented, 0, 499).content).toBe("x".repeat(498));
    // A Hangul syllable written in its letters: a consonant, a vowel and a final consonant.
    const syllable = String.fromCodePoint(0x1112, 0x1161, 0x11ab);
    const letters = `${"x".repeat(100)}${syllable.repeat(50)}`;
    expect(contextLinesPage(letters, 0, 100 + 18 + 3).content).toBe(
      `${"x".repeat(100)}${syllable.repeat(2)}`,
    );
    // Three people joined into one family: the bytes run out after the first joiner.
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const joined = `${"x".repeat(100)}${family}${"x".repeat(100)}`;
    expect(contextLinesPage(joined, 0, 100 + 4 + 3).content).toBe("x".repeat(100));
    expect(contextLinesPage(joined, 0, 100 + 4).content).toBe("x".repeat(100));
    // A run of marks longer than a page looks back over is cut as it is, and the page advances.
    const hostile = `${"x".repeat(10)}e${accent.repeat(100)}x`;
    expect(contextLinesPage(hostile, 0, 10 + 1 + 100).content.length).toBe(61);
    for (const text of [accented, letters, joined, hostile]) {
      for (const budget of [16, 64, 107, 499]) {
        const pages: string[] = [];
        for (let offset = 0; offset < text.length; ) {
          const page = contextLinesPage(text, offset, budget);
          expect(page.content.length).toBeGreaterThan(0);
          expect(page.bytes).toBeLessThanOrEqual(budget);
          pages.push(page.content);
          offset += page.content.length;
        }
        expect(pages.join("")).toBe(text);
      }
    }
  });

  it("says where the pages of a context end inside something", () => {
    const body = `# Skill\n\n${paragraph(300)}\n`;
    const file = `${paragraph(100)}\n${table(400)}\nAfter.\n`;
    const cuts = contextPageCuts([body, file], 8_000);
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts.every((cut) => cut.text === 1 && cut.inside === "table")).toBe(true);
    const first = cuts[0];
    expect(first?.page).toBe(1);
    expect(file.slice(first?.offset).startsWith("| item ")).toBe(true);
    expect(first?.line).toBe(file.slice(0, first?.offset).split("\n").length);
    // The pages counted from where one ended are the pages that are left.
    const all = countContextPages([body, file], 8_000);
    expect(all).toBe(cuts.length + 1);
    expect(countContextPages([body, file], 8_000, body.length + (first?.offset ?? 0))).toBe(
      all - 1,
    );

    const code = `${paragraph(100)}\n\`\`\`sh\n${"echo one\n".repeat(900)}\`\`\`\n`;
    expect(contextPageCuts([code], 4_000).map((cut) => cut.inside)).toEqual(["code", "code"]);
    expect(contextPageCuts([paragraph(2_000)], 4_000)[0]).toEqual({
      page: 1,
      text: 0,
      offset: 4_000,
      line: 1,
      inside: "line",
    });
    // Between two blocks, and between two texts, a page ends inside nothing.
    expect(contextPageCuts([paragraph(100).repeat(30)], 4_000)).toEqual([]);
    expect(contextPageCuts([paragraph(100).repeat(8), paragraph(100).repeat(8)], 4_000)).toEqual(
      [],
    );
    expect(contextPageCuts([], 4_000)).toEqual([]);
    // What a page ends inside is read from the text as a page end is.
    const opening = "# Title\n\nThen:\n\n- one\n";
    expect(contextCutAt(opening, "# Title\n".length)).toBe("opening");
    expect(contextCutAt(opening, "# Title\n\nThen:\n".length)).toBe("opening");
    expect(contextCutAt(opening, 3)).toBe("line");
    expect(contextCutAt(opening, 0)).toBeUndefined();
    expect(contextCutAt(opening, opening.length)).toBeUndefined();
  });

  it("gives a text of several scripts whole and nothing of it twice, within its bytes", () => {
    let seed = 20261122;
    const next = (below: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    const word = (): string =>
      [
        "word",
        hangul(1 + next(4)),
        String.fromCodePoint(0x3042 + next(40)).repeat(1 + next(6)),
        String.fromCodePoint(0x1f600 + next(40)),
        `e${String.fromCodePoint(0x301)}`,
      ][next(5)] ?? "";
    const line = (words: number, joiner: string): string =>
      Array.from({ length: words }, word).join(joiner);
    const blocks: string[] = [];
    for (let block = 0; block < 120; block += 1) {
      const kind = next(6);
      if (kind === 0) blocks.push(`## ${line(3, " ")}\n\n`);
      else if (kind === 1)
        blocks.push(`${line(4, " ")}:\n\n- ${line(5, " ")}\n- ${line(5, " ")}\n\n`);
      else if (kind === 2)
        blocks.push(
          `| a | b |\n|---|---|\n${Array.from({ length: 1 + next(60) }, () => `| ${line(3, " ")} | ${line(3, " ")} |\n`).join("")}\n`,
        );
      else if (kind === 3)
        blocks.push(
          `\`\`\`\n${Array.from({ length: 1 + next(80) }, () => `${line(6, " ")}\n`).join("")}\`\`\`\n\n`,
        );
      // A line of a script that puts no space between its words, longer than a small page.
      else if (kind === 4) blocks.push(`${line(40 + next(400), "")}\n\n`);
      else blocks.push(`${line(20 + next(200), " ")}\n\n`);
    }
    const text = blocks.join("");
    for (const budget of [64, 300, 1_024, 4_096, 16_384]) {
      const pages: string[] = [];
      for (let offset = 0; offset < text.length; ) {
        const page = contextLinesPage(text, offset, budget);
        expect(page.content.length).toBeGreaterThan(0);
        expect(page.bytes).toBe(bytesOf(page.content));
        expect(page.bytes).toBeLessThanOrEqual(budget);
        pages.push(page.content);
        offset += page.content.length;
        // A line that fits a page is on one page: only a longer one is cut.
        if (offset < text.length && !page.content.endsWith("\n")) {
          const from = text.lastIndexOf("\n", offset - 1) + 1;
          const to = text.indexOf("\n", offset);
          expect(bytesOf(text.slice(from, to === -1 ? text.length : to + 1))).toBeGreaterThan(
            budget,
          );
        }
      }
      expect(pages.join("")).toBe(text);
    }
  });
});
