import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogTable, firstSentence, relativeLink, writeCatalogRegions } from "./catalog.js";
import { EXIT_MISSING, EXIT_UNREADABLE, EXIT_USAGE, runCli } from "./cli.js";

const SKILLS = [
  {
    path: "marketing/ads/SKILL.md",
    name: "ads",
    description: "Writes ad copy for a product page. Use when a launch is due.",
  },
  {
    path: "engineering/release-notes/SKILL.md",
    name: "release-notes",
    description: "Writes release notes | from merged pull requests.",
  },
  { path: "engineering/review/SKILL.md", name: "review", description: "Reviews a change" },
];

describe("the table of a pack's skills (ADR-0121)", () => {
  it("takes the first sentence of a description, on one line", () => {
    expect(firstSentence("Writes ad copy. Use when a launch is due.")).toBe("Writes ad copy.");
    expect(firstSentence("Reads v1.2 files, e.g. these.\nUse it often.")).toBe(
      "Reads v1.2 files, e.g. these.",
    );
    expect(firstSentence("No end mark")).toBe("No end mark");
    expect(firstSentence("Is it done? Ask.")).toBe("Is it done?");
    const long = firstSentence(`${"word ".repeat(80)}end.`);
    expect(long.length).toBe(200);
    expect(long.endsWith("…")).toBe(true);
  });

  it("writes a link from the folder of the file that holds the table", () => {
    expect(relativeLink("", "marketing/ads/SKILL.md")).toBe("marketing/ads/SKILL.md");
    expect(relativeLink("marketing", "marketing/ads/SKILL.md")).toBe("ads/SKILL.md");
    expect(relativeLink("docs/pack", "marketing/ads/SKILL.md")).toBe(
      "../../marketing/ads/SKILL.md",
    );
    expect(relativeLink("a", "a b/c d/SKILL.md")).toBe("../a%20b/c%20d/SKILL.md");
  });

  it("lists the skills under a folder in path order, with how many there are", () => {
    expect(catalogTable(SKILLS, "", "")).toBe(
      [
        "| Skill | What it does |",
        "|---|---|",
        "| [release-notes](engineering/release-notes/SKILL.md) | Writes release notes \\| from merged pull requests. |",
        "| [review](engineering/review/SKILL.md) | Reviews a change |",
        "| [ads](marketing/ads/SKILL.md) | Writes ad copy for a product page. |",
        "",
        "3 skills.",
      ].join("\n"),
    );
    expect(catalogTable(SKILLS, "marketing", "marketing")).toBe(
      "| Skill | What it does |\n|---|---|\n| [ads](ads/SKILL.md) | Writes ad copy for a product page. |\n\n1 skill.",
    );
    // A folder whose name another begins with holds none of the other's skills.
    expect(catalogTable(SKILLS, "market", "")).toBe("No skills.");
  });

  it("writes every region of a file again and nothing outside them", () => {
    const text = [
      "# Acme",
      "",
      "<!-- skillcdn:catalog -->",
      "an old table",
      "<!-- /skillcdn:catalog -->",
      "",
      "## Marketing",
      "",
      "<!--skillcdn:catalog folder=marketing-->",
      "<!--/skillcdn:catalog-->",
      "",
      "The end.",
      "",
    ].join("\n");
    const made = writeCatalogRegions(text, "", SKILLS);
    expect(made.regions).toBe(2);
    expect(made.stale).toBe(2);
    expect(made.text).toContain(
      `# Acme\n\n<!-- skillcdn:catalog -->\n${catalogTable(SKILLS, "", "")}\n<!-- /skillcdn:catalog -->\n\n## Marketing\n\n`,
    );
    expect(made.text).toContain(
      `<!--skillcdn:catalog folder=marketing-->\n${catalogTable(SKILLS, "marketing", "")}\n<!--/skillcdn:catalog-->\n\nThe end.\n`,
    );
    expect(made.text).not.toContain("an old table");
    // Written once, it is what it would be written as.
    expect(writeCatalogRegions(made.text, "", SKILLS)).toEqual({
      text: made.text,
      regions: 2,
      stale: 0,
    });
    // A region of a file in a folder lists that folder, with links from it.
    const area = writeCatalogRegions(
      "<!-- skillcdn:catalog -->\n<!-- /skillcdn:catalog -->\n",
      "engineering",
      SKILLS,
    );
    expect(area.text).toContain("| [review](review/SKILL.md) | Reviews a change |\n\n2 skills.");
    // A file written with the line ends of another system keeps them.
    const crlf = writeCatalogRegions(
      "A\r\n<!-- skillcdn:catalog -->\r\n<!-- /skillcdn:catalog -->\r\n",
      "marketing",
      SKILLS,
    );
    expect(crlf.text).toContain("|---|---|\r\n| [ads](ads/SKILL.md)");
    expect(crlf.text).not.toMatch(/[^\r]\n/);
    expect(writeCatalogRegions("No region here.\n", "", SKILLS)).toEqual({
      text: "No region here.\n",
      regions: 0,
      stale: 0,
    });
  });
});

async function run(args: string[], cwd?: string) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    environment: {},
    cwd,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillcdn-catalog-"));
  for (const [name, contents] of Object.entries(files)) {
    const parts = name.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

describe("skillcdn catalog", () => {
  const files = {
    "README.md": "# Acme\n\n<!-- skillcdn:catalog -->\n<!-- /skillcdn:catalog -->\n\nMore.\n",
    "marketing/README.md": "# Marketing\n\n<!-- skillcdn:catalog -->\n<!-- /skillcdn:catalog -->\n",
    "marketing/ads/SKILL.md": skill("ads", "Writes ad copy. Use when a launch is due."),
    "engineering/review/SKILL.md": skill("review", "Reviews a change."),
    // A copy under a hidden directory is not a skill a search lists, and not a row.
    ".claude/skills/review/SKILL.md": skill("review", "Reviews a change."),
    "docs/plain.md": "# Plain\n",
  };

  it("prints the table, writes it into the regions of a file, and says when one is out of date", async () => {
    const root = await repository(files);
    const printed = await run(["catalog", root]);
    expect(printed.code).toBe(0);
    expect(printed.out).toBe(
      "| Skill | What it does |\n|---|---|\n| [review](engineering/review/SKILL.md) | Reviews a change. |\n| [ads](marketing/ads/SKILL.md) | Writes ad copy. |\n\n2 skills.\n",
    );
    expect((await run(["catalog", root, "--folder", "marketing/"])).out).toContain("1 skill.");

    const readme = join(root, "README.md");
    const area = join(root, "marketing", "README.md");
    const stale = await run(["catalog", root, "--check", readme, "--check", area]);
    expect(stale.code).toBe(EXIT_MISSING);
    expect(stale.out).toContain("README.md: out of date (1 of 1 region); skillcdn catalog --write");
    expect(await readFile(readme, "utf8")).toBe(files["README.md"]);

    const written = await run(["catalog", root, "--write", readme, "--write", area]);
    expect(written.code).toBe(0);
    expect(written.out).toContain("README.md: written (1 of 1 region changed)");
    expect(await readFile(readme, "utf8")).toBe(
      "# Acme\n\n<!-- skillcdn:catalog -->\n| Skill | What it does |\n|---|---|\n| [review](engineering/review/SKILL.md) | Reviews a change. |\n| [ads](marketing/ads/SKILL.md) | Writes ad copy. |\n\n2 skills.\n<!-- /skillcdn:catalog -->\n\nMore.\n",
    );
    expect(await readFile(area, "utf8")).toContain("| [ads](ads/SKILL.md) | Writes ad copy. |");

    // What was written is up to date, until the pack changes.
    const fresh = await run(["catalog", root, "--check", readme, "--check", area]);
    expect(fresh.code).toBe(0);
    expect(fresh.out).toContain("README.md: up to date (1 region)");
    await mkdir(join(root, "marketing", "posts"), { recursive: true });
    await writeFile(join(root, "marketing", "posts", "SKILL.md"), skill("posts", "Writes posts."));
    expect((await run(["catalog", root, "--check", readme])).code).toBe(EXIT_MISSING);
    // The directory may be the one the command runs in, and the file named from there.
    expect((await run(["catalog", "--write", "README.md"], root)).code).toBe(0);
    expect(await readFile(readme, "utf8")).toContain("3 skills.");
  });

  it("refuses what it cannot write or was not asked right", async () => {
    const root = await repository(files);
    const none = await run(["catalog", root, "--write", join(root, "docs", "plain.md")]);
    expect(none.code).toBe(EXIT_MISSING);
    expect(none.err).toContain("no region to write: put <!-- skillcdn:catalog -->");
    expect(await readFile(join(root, "docs", "plain.md"), "utf8")).toBe("# Plain\n");
    expect((await run(["catalog", root, "--check", join(root, "nowhere.md")])).code).toBe(
      EXIT_UNREADABLE,
    );
    expect((await run(["catalog", join(root, "nowhere")])).code).toBe(EXIT_UNREADABLE);
    const outside = await run(["catalog", root, "--write", join(tmpdir(), "elsewhere.md")]);
    expect(outside.code).toBe(EXIT_USAGE);
    expect((await run(["catalog", root, "--folder", "a", "--check", "README.md"])).code).toBe(
      EXIT_USAGE,
    );
    expect((await run(["catalog", "--help"])).out).toContain("usage: skillcdn catalog");
  });
});
