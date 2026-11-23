import { type EmbeddedText, HEAD_SECTION } from "@skillcdn/core";

// Which text of the body a path held in the commit before stands where a text of the body it
// holds now stands (ADR-0127): what a text that has no vector yet is lent the vector of, until
// the worker embeds it. A place is all that is compared. What the texts say is the hash's to
// compare, and a text that says what it said has its own vector already (ADR-0107).

/**
 * Where a section stands in its body: under a heading or before the first, and the headings
 * below the first. The first heading is the title as a rule, and a body given a new title has
 * its sections where they were.
 */
const placeOf = (item: EmbeddedText): string =>
  JSON.stringify([item.heading.length > 0, ...item.heading.slice(1)]);

/**
 * For each text of `now`, the number of the section of `before` that stood in its place, and
 * `undefined` where nothing did: a skill's head for its head; for a section, the section under
 * the same headings below the first, the second such for the second; and, where the two bodies
 * are cut into as many sections, the section at the same place in their order for one whose
 * headings are new. A section of `before` stands for one section of `now` at most.
 */
export function textsInPlace(
  now: readonly EmbeddedText[],
  before: readonly EmbeddedText[],
): (number | undefined)[] {
  const head = before.find((item) => item.section === HEAD_SECTION);
  const sectionsBefore = before.filter((item) => item.section !== HEAD_SECTION);
  const sectionsNow = now.filter((item) => item.section !== HEAD_SECTION);
  const standing = new Map<string, number[]>();
  for (const item of sectionsBefore) {
    const place = placeOf(item);
    standing.set(place, [...(standing.get(place) ?? []), item.section]);
  }
  const places = new Map<number, number>();
  const taken = new Set<number>();
  for (const item of sectionsNow) {
    const stood = standing.get(placeOf(item))?.shift();
    if (stood !== undefined) {
      places.set(item.section, stood);
      taken.add(stood);
    }
  }
  if (sectionsNow.length === sectionsBefore.length) {
    sectionsNow.forEach((item, at) => {
      const stood = sectionsBefore[at]?.section;
      if (!places.has(item.section) && stood !== undefined && !taken.has(stood)) {
        places.set(item.section, stood);
        taken.add(stood);
      }
    });
  }
  return now.map((item) =>
    item.section === HEAD_SECTION ? head?.section : places.get(item.section),
  );
}
