import type { IncludedFile, SkillResult, SkillRules } from "./results.js";

// A skill is read in pages of its context (docs/specs/tools.md): the rules, the body and the
// included files, each of which a page may end inside. A program that reads every page gives
// the agent the skill whole; this joins the pages back into the one result they were cut from.

/**
 * Fragments of several texts in page order, joined by path. A page may name every text of the
 * context, each cut where the page is: empty where the page has not reached it yet or has passed
 * it, so the fragments of one text need not be neighbours. A fragment with text continues the
 * first cut text of its path; an empty one adds nothing once its path is known.
 */
function joinFragments<T extends { readonly path: unknown; readonly truncated: boolean }>(
  pages: readonly (readonly T[])[],
  textOf: (fragment: T) => string,
  withText: (fragment: T, text: string, truncated: boolean) => T,
): T[] {
  const joined: T[] = [];
  for (const page of pages) {
    for (const fragment of page) {
      const text = textOf(fragment);
      const open = joined.findIndex((known) => known.truncated && known.path === fragment.path);
      const known = open === -1 ? undefined : joined[open];
      if (known !== undefined && text.length > 0) {
        joined[open] = withText(known, `${textOf(known)}${text}`, fragment.truncated);
      } else if (text.length > 0 || !joined.some((other) => other.path === fragment.path)) {
        joined.push(fragment);
      }
    }
  }
  return joined;
}

/**
 * The pages of one skill, read in order with the cursor each one gave, as the whole skill: the
 * first page's facts, every fragment of the rules, the body and the included files joined, and
 * the last page's word on whether the skill is complete. `undefined` without a page.
 */
export function joinSkillPages(pages: readonly SkillResult[]): SkillResult | undefined {
  const [first] = pages;
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const ruleChain = joinFragments<SkillRules>(
    pages.map((page) => page.ruleChain ?? []),
    (rule) => rule.body,
    (rule, body, truncated) => ({ ...rule, body, truncated }),
  );
  const included = joinFragments<IncludedFile>(
    pages.map((page) => page.included),
    (file) => file.content ?? "",
    (file, content, truncated) => ({ ...file, content, truncated }),
  );
  const warnings = [...new Set(pages.flatMap((page) => page.warnings))];
  return {
    ...first,
    ruleChain,
    body: pages.map((page) => page.body).join(""),
    included,
    warnings,
    rules: ruleChain[0],
    complete: last.complete,
    nextCursor: last.nextCursor,
  };
}
