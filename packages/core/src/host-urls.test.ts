import { describe, expect, it } from "vitest";
import {
  accountAvatarUrl,
  accountPageUrl,
  blobFileUrl,
  lfsFileUrl,
  rawFileUrl,
} from "./host-urls.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";

const path = (value: string): RepoPath => {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
};

describe("the URLs at a host", () => {
  it("names the bytes of a file of a commit as the git host serves them", () => {
    expect(
      rawFileUrl(
        { host: "gh", owner: "Acme", name: "skills" },
        "a".repeat(40),
        path("img/a b.png"),
      ),
    ).toBe(`https://raw.githubusercontent.com/Acme/skills/${"a".repeat(40)}/img/a%20b.png`);
    expect(accountPageUrl("gh", "Acme")).toBe("https://github.com/Acme");
    expect(accountAvatarUrl("gh", "12345", 160)).toBe(
      "https://avatars.githubusercontent.com/u/12345?s=160&v=4",
    );
  });

  it("names the deployment's own route for a pack served from a directory, which has no bytes at any host (ADR-0077)", () => {
    expect(
      rawFileUrl(
        { host: "local", owner: "acme", name: "handbook" },
        "b".repeat(40),
        path("docs/sources/a b.pdf"),
      ),
    ).toBe("/api/v1/raw/local/acme/handbook?path=docs%2Fsources%2Fa%20b.pdf");
  });

  it("names a file by what it holds, which no commit moves (ADR-0117)", () => {
    expect(
      blobFileUrl({ host: "gh", owner: "Acme", name: "skills" }, "b".repeat(40), path("a b.json")),
    ).toEqual({
      sourceUrl: `https://api.github.com/repos/Acme/skills/git/blobs/${"b".repeat(40)}`,
      accept: "application/vnd.github.raw+json",
    });
    // A directory has its file and no commit: its own route, and nothing to ask it for.
    expect(
      blobFileUrl(
        { host: "local", owner: "acme", name: "handbook" },
        "b".repeat(40),
        path("a.json"),
      ),
    ).toEqual({ sourceUrl: "/api/v1/raw/local/acme/handbook?path=a.json" });
  });

  it("names GitHub's own raw route for a file kept in Git LFS, which the raw host does not serve", () => {
    expect(
      lfsFileUrl(
        { host: "gh", owner: "Acme", name: "skills" },
        "a".repeat(40),
        path("docs/sources/manual.pdf"),
      ),
    ).toBe(`https://github.com/Acme/skills/raw/${"a".repeat(40)}/docs/sources/manual.pdf`);
    expect(
      lfsFileUrl({ host: "local", owner: "acme", name: "handbook" }, "b".repeat(40), path("a.pdf")),
    ).toBe("/api/v1/raw/local/acme/handbook?path=a.pdf");
  });
});
