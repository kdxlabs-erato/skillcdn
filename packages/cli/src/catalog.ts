// The table of a pack's skills for the people who read its README at the git host (ADR-0121).
// An agent is given the same list by the tools; this is the copy a README keeps, made by the
// command and held to what the pack has: a region between two comments is written again, or
// checked against what would be written. Nothing here reads a file or the network.

/** A skill as the table names it. */
export interface CatalogSkill {
  /** The repository-root path of its `SKILL.md`. */
  readonly path: string;
  readonly name: string;
  readonly description: string;
}

/** The comment that opens a region, with the folder it may name, and the one that closes it. */
const REGION =
  /(<!--[ \t]*skillcdn:catalog(?:[ \t]+folder=([^\s>]+))?[ \t]*-->)[\s\S]*?(<!--[ \t]*\/skillcdn:catalog[ \t]*-->)/g;

/** How much of a description a row carries where it has no sentence end sooner. */
const MAX_CELL_LENGTH = 200;

/**
 * What a row says a skill is for: the first sentence of its description, which the format asks
 * to say what the skill does, on one line and no longer than a row reads well.
 */
export function firstSentence(description: string): string {
  const flat = description.replaceAll(/\s+/g, " ").trim();
  // A sentence ends at a mark followed by a space and a capital, a digit or a quote, or at the
  // end: a mark inside a name, `v1.2` or `e.g. this`, does not end one.
  const end = /[.!?](?=\s+["'(\p{Lu}\p{N}]|\s*$)/u.exec(flat);
  const sentence = end === null ? flat : flat.slice(0, end.index + 1);
  return sentence.length <= MAX_CELL_LENGTH
    ? sentence
    : `${sentence.slice(0, MAX_CELL_LENGTH - 1).trimEnd()}…`;
}

const cell = (text: string): string => text.replaceAll("|", "\\|");

/** The path from the directory `from` to `to`, both from the repository root, as a link is written. */
export function relativeLink(from: string, to: string): string {
  const base = from.length === 0 ? [] : from.split("/");
  const target = to.split("/");
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) {
    shared += 1;
  }
  const up = base.slice(shared).map(() => "..");
  return [...up, ...target.slice(shared)].map((segment) => encodeURI(segment)).join("/");
}

/**
 * The table of the skills under `folder`, in path order, with links written from `linkFrom`,
 * the directory of the file the table stands in; then how many there are.
 */
export function catalogTable(
  skills: readonly CatalogSkill[],
  folder: string,
  linkFrom: string,
): string {
  const under = skills
    .filter((skill) => folder.length === 0 || skill.path.startsWith(`${folder}/`))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (under.length === 0) return "No skills.";
  const rows = under.map(
    (skill) =>
      `| [${cell(skill.name)}](${relativeLink(linkFrom, skill.path)}) | ${cell(firstSentence(skill.description))} |`,
  );
  return `| Skill | What it does |\n|---|---|\n${rows.join("\n")}\n\n${under.length} ${under.length === 1 ? "skill" : "skills"}.`;
}

export interface CatalogRegions {
  /** The text with every region written again. */
  readonly text: string;
  /** How many regions the text has. */
  readonly regions: number;
  /** How many of them differed from what the pack has. */
  readonly stale: number;
}

/**
 * Writes every region of `text` again: what stands between `<!-- skillcdn:catalog -->` and
 * `<!-- /skillcdn:catalog -->` becomes the table of the skills under the folder the opening
 * comment names (`folder=<path>`, from the repository root), or under the directory of the file
 * itself when it names none. The comments stay, and everything outside them is untouched.
 */
export function writeCatalogRegions(
  text: string,
  fileDirectory: string,
  skills: readonly CatalogSkill[],
): CatalogRegions {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let regions = 0;
  let stale = 0;
  const written = text.replace(
    REGION,
    (whole: string, open: string, named: string | undefined, close: string) => {
      regions += 1;
      const folder = (named ?? fileDirectory).replace(/^\.\/?|\/+$/g, "");
      const table = catalogTable(skills, folder === "." ? "" : folder, fileDirectory);
      const region = `${open}${newline}${table.replaceAll("\n", newline)}${newline}${close}`;
      if (region !== whole) stale += 1;
      return region;
    },
  );
  return { text: written, regions, stale };
}
