import { describe, expect, it } from "vitest";
import { contextLinesPage, contextPage } from "./context-page.js";

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
