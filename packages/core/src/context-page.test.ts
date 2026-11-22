import { describe, expect, it } from "vitest";
import { contextLinesPage, contextPage, pageOfContext, tableHeadAt } from "./context-page.js";

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
    // A line end too far back would waste the page: the words near the end are where it stops.
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
