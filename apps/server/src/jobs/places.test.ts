import { type EmbeddedEntry, embeddedTextsOf, HEAD_SECTION } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { textsInPlace } from "./places.js";

// The text that stood where a text stands now (ADR-0127), by the place alone.

const skill = (name: string, description: string): EmbeddedEntry => ({
  kind: "skill",
  name,
  description,
});
const document: EmbeddedEntry = { kind: "markdown" };

const body = (title: string, sections: readonly (readonly [string, string])[]): string =>
  [
    `# ${title}`,
    "What this is.",
    ...sections.flatMap(([heading, text]) => [heading, text]),
    "",
  ].join("\n\n");

/** The headings of the texts of `before` that stand in the place of each text of `now`. */
const stoodFor = (now: string, before: string, entry: EmbeddedEntry = document) => {
  const texts = embeddedTextsOf(entry, now);
  const earlier = embeddedTextsOf(entry, before);
  return textsInPlace(texts, earlier).map((section) => {
    const stood = earlier.find((item) => item.section === section);
    return stood === undefined ? undefined : (stood.heading.at(-1) ?? "");
  });
};

describe("textsInPlace", () => {
  const before = body("Item deep dive", [
    ["## Inputs", "The item to look into."],
    ["## Steps", "Look into the item."],
    ["### Report", "Write what the item is worth."],
  ]);

  it("names the section under the same headings, whatever the title above them", () => {
    const retitled = before.replace("# Item deep dive", "# Business idea deep dive");
    expect(stoodFor(retitled, before)).toEqual(["Item deep dive", "Inputs", "Steps", "Report"]);
    // A section added is in nobody's place, and the others are still in theirs.
    const grown = `${retitled}\n## Hard rules\n\nNever guess a number.\n`;
    expect(stoodFor(grown, before)).toEqual([
      "Item deep dive",
      "Inputs",
      "Steps",
      "Report",
      undefined,
    ]);
    // One taken out: the sections after it are found by their headings, not by their order.
    const shorter = before.replace("## Inputs\n\nThe item to look into.\n\n", "");
    expect(stoodFor(shorter, before)).toEqual(["Item deep dive", "Steps", "Report"]);
  });

  it("names the section at the same place in the order for one whose heading is new, where the two have as many", () => {
    const renamed = before.replace("## Inputs", "## What to bring");
    expect(stoodFor(renamed, before)).toEqual(["Item deep dive", "Inputs", "Steps", "Report"]);
    // With one section more, the order says nothing of which is which.
    expect(stoodFor(`${renamed}\n## Hard rules\n\nNever guess.\n`, before)).toEqual([
      "Item deep dive",
      undefined,
      "Steps",
      "Report",
      undefined,
    ]);
  });

  it("gives a section of before to one section at most, the second of a name to the second", () => {
    const twice = body("Guide", [
      ["## Example", "The first."],
      ["## Example", "The second."],
    ]);
    const texts = embeddedTextsOf(document, twice);
    expect(textsInPlace(texts, texts)).toEqual(texts.map((item) => item.section));
    const thrice = `${twice}\n## Example\n\nThe third.\n`;
    expect(textsInPlace(embeddedTextsOf(document, thrice), texts)).toEqual([0, 1, 2, undefined]);
  });

  it("names a skill's head for its head, and nothing where there was none", () => {
    const now = embeddedTextsOf(skill("idea-deep-dive", "Looks into a business idea."), before);
    const earlier = embeddedTextsOf(skill("item-deep-dive", "Looks into an item."), before);
    expect(now[0]?.section).toBe(HEAD_SECTION);
    expect(textsInPlace(now, earlier)).toEqual([HEAD_SECTION, 0, 1, 2, 3]);
    // The same path held a document before: it had no head to lend.
    expect(textsInPlace(now, embeddedTextsOf(document, before))).toEqual([undefined, 0, 1, 2, 3]);
    expect(textsInPlace(now, [])).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("keeps the text before the first heading apart from the section the first heading opens", () => {
    const led = `A line before any heading.\n\n${before}`;
    expect(stoodFor(led, before)).toEqual([
      undefined,
      "Item deep dive",
      "Inputs",
      "Steps",
      "Report",
    ]);
    expect(stoodFor(before, led)).toEqual(["Item deep dive", "Inputs", "Steps", "Report"]);
  });
});
