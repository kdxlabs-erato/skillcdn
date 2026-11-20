import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_LIMIT_DEFAULTS } from "@skillcdn/indexer";
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import {
  COMMAND_WORDS,
  type Pack,
  PackError,
  ReadMisuse,
  readNumber,
  readPack,
  shellWord,
  wroteLine,
} from "./index.js";
import { openDirectory } from "./local.js";

// The reads as a library (ADR-0110): what another program with commands of its own prints of a
// pack, in its own words, the same text the command prints in its words.

async function directoryPack(): Promise<{ root: string; pack: Pack }> {
  const parent = await mkdtemp(join(tmpdir(), "skillcdn-library-"));
  const root = join(parent, "acme-skills");
  const files: Record<string, string> = {
    "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief.\n",
    "marketing/ads/SKILL.md":
      "---\nname: ads\ndescription: Writes ad copy for a product page.\n---\n# Ads\n\nWrite three variants.\n",
    "docs/codes.md":
      "# Codes\n\n| Code | Meaning |\n|---|---|\n| A1 | Open |\n| B2 | Closed |\n\n```sh\necho codes\n```\n",
  };
  for (const [file, text] of Object.entries(files)) {
    const parts = file.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), text);
  }
  const pack = await openDirectory({ directory: root, limits: INDEX_LIMIT_DEFAULTS });
  if ("error" in pack) throw new Error("the directory is a pack");
  return { root, pack };
}

async function printed(args: string[]): Promise<string> {
  let out = "";
  const code = await runCli(args, {
    environment: {},
    stdout: (text) => {
      out += text;
    },
    stderr: () => {},
  });
  expect(code).toBe(0);
  return out;
}

const CONSOLE_WORDS = {
  browse: "console skills",
  search: "console skills --search",
  load: "console skill",
  read: "console skill --file",
};

describe("the reads of a pack as a library", () => {
  it("prints what the command prints, in the words of the command that asks", async () => {
    const { root, pack } = await directoryPack();
    for (const [args, read] of [
      [["skills", root], { read: "skills" }],
      [["find", root, "ad", "copy"], { read: "find", words: "ad copy" }],
      [
        ["skill", root, "marketing/ads/SKILL.md"],
        { read: "skill", path: "marketing/ads/SKILL.md" },
      ],
      [["file", root, "docs/codes.md"], { read: "file", path: "docs/codes.md" }],
      [["browse", root, "docs"], { read: "browse", path: "docs" }],
    ] as const) {
      const output = await readPack(pack, read, { words: COMMAND_WORDS });
      expect(`${output.text}\n`).toBe(await printed([...args]));
    }
    // Another command's words, wherever the text names a read.
    const listed = await readPack(pack, { read: "skills" }, { words: CONSOLE_WORDS });
    expect(listed.text).toContain("console skills");
    expect(listed.text).not.toContain("skillcdn browse");
  });

  it("gives the data of a document, and what it holds for the line that says it was written", async () => {
    const { pack } = await directoryPack();
    const rows = await readPack(pack, { read: "rows", path: "docs/codes.md" });
    expect(rows.text).toContain("A1");
    expect(rows.holds).toBe("2 rows of 1 table");
    expect(wroteLine(rows.holds ?? "", "codes.csv")).toBe("Wrote 2 rows of 1 table to codes.csv.");
    const code = await readPack(pack, { read: "code", path: "docs/codes.md", grep: "echo" });
    expect(code.holds).toBe("1 code block");
    expect(code.text).toContain("--- docs/codes.md > Codes (sh) ---\necho codes\n");
  });

  it("stops reading a pack that pages without end, or answers the same page again", async () => {
    const { pack } = await directoryPack();
    let asked = 0;
    const wrapped = (over: Partial<Pack>): Pack => ({
      address: pack.address,
      source: pack.source,
      mount: () => pack.mount(),
      browse: (query) => pack.browse(query),
      find: (query) => pack.find(query),
      skill: (path, cursor) => pack.skill(path, cursor),
      file: (query) => pack.file(query),
      rows: (query) => pack.rows(query),
      code: (query) => pack.code(query),
      ...over,
    });
    const skillThat = (cursorOf: () => string): Pack =>
      wrapped({
        skill: async (path) => {
          asked += 1;
          const body = await pack.skill(path);
          if (body.status !== "ready") throw new Error("the skill is there");
          return { ...body, skill: { ...body.skill, complete: false, nextCursor: cursorOf() } };
        },
      });
    const read = { read: "skill", path: "marketing/ads/SKILL.md" } as const;
    // Every page names a new one: the read gives up at the bound, far above what a skill holds.
    await expect(
      readPack(
        skillThat(() => `page-${asked}`),
        read,
        { json: true },
      ),
    ).rejects.toThrow("The skill did not complete within the pages one read takes.");
    expect(asked).toBe(256);
    // The page asked for comes back naming itself: the read does not ask a third time.
    asked = 0;
    const same = await readPack(
      skillThat(() => "again"),
      read,
      { json: true },
    ).catch((error: unknown) => error);
    expect(same).toBeInstanceOf(PackError);
    expect((same as PackError).code).toBe("invalid_response");
    expect(asked).toBe(2);
    // The listing of the pack is read the same way.
    asked = 0;
    const listing = wrapped({
      find: async (query) => {
        asked += 1;
        const body = await pack.find({ ...query, cursor: undefined });
        if (body.status !== "ready") throw new Error("the listing is there");
        return { ...body, nextCursor: "again" };
      },
    });
    await expect(readPack(listing, { read: "skills" })).rejects.toThrow(
      "The pack answers more pages of its listing than one read takes.",
    );
    expect(asked).toBe(2);
  });

  it("names the next part of a skill by a command line a shell reads as it was meant", async () => {
    expect(shellWord("marketing/ads/SKILL.md")).toBe("marketing/ads/SKILL.md");
    expect(shellWord("notes for sales/SKILL.md")).toBe("'notes for sales/SKILL.md'");
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
  });

  it("throws what the pack does not have, and what was not asked right, for the caller to say", async () => {
    const { pack } = await directoryPack();
    const missing = await readPack(
      pack,
      { read: "skill", path: "nowhere/SKILL.md" },
      {
        words: CONSOLE_WORDS,
      },
    ).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(PackError);
    expect((missing as PackError).code).toBe("skill.not_found");
    expect((missing as PackError).message).toContain(
      "Use console skills or console skills --search",
    );
    expect((missing as PackError).message).toContain("Available: marketing/ads/SKILL.md");
    await expect(readPack(pack, { read: "browse", limit: "0" })).rejects.toThrow(ReadMisuse);
    await expect(readPack(pack, { read: "find", words: "  " })).rejects.toThrow(
      "Say the words to find.",
    );
    expect(() => readNumber("201", "limit", 200)).toThrow(
      "--limit takes an integer between 1 and 200",
    );
    expect(readNumber(undefined, "limit", 200)).toBeUndefined();
    expect(readNumber(7, "offset", 100)).toBe(7);
  });
});
