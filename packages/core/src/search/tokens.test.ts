import { describe, expect, it } from "vitest";
import { cutToTokens, estimatedTokens } from "./tokens.js";

const fill = (text: string, length = 400): string => {
  let filled = "";
  while (filled.length < length) filled += text;
  return filled.slice(0, length);
};

// Samples of 400 characters, and the tokens per character one embedding model's tokenizer
// counted for the same kinds of text (ADR-0105).
const hexLines = Array.from({ length: 8 }, (_, line) =>
  Array.from({ length: 64 }, (_, at) => "0123456789abcdef"[(line * 7 + at * 11) % 16]).join(""),
).join("\n");
const numberTable = [
  "| id | p50 | p90 | max |",
  "|---|---|---|---|",
  ...Array.from(
    { length: 20 },
    (_, at) =>
      `| ${1000 + at * 37} | ${(at * 7.31 + 12.5).toFixed(2)} | ${(at * 13.7 + 88.1).toFixed(2)} | ${9000 + at * 913} |`,
  ),
].join("\n");
const MEASURED: readonly (readonly [string, string, number])[] = [
  [
    "English",
    "Before a deploy, run the migration in the staging environment first and read its result, then apply it to production. A change to the schema of the database is hard to undo, so confirm that the backup has finished. ",
    0.2,
  ],
  [
    "Russian",
    "Перед развёртыванием сначала выполните миграцию в тестовой среде и проверьте результат, затем примените её в рабочей среде. ",
    0.32,
  ],
  [
    "Japanese",
    "デプロイの前にステージング環境でマイグレーションを実行し、結果を確認してから本番環境に適用します。",
    0.59,
  ],
  ["Chinese", "在部署之前，先在预发布环境中执行数据库迁移，确认结果无误后再应用到生产环境。", 0.59],
  [
    "Korean",
    "배포 전에 스테이징 환경에서 마이그레이션을 먼저 실행하고, 결과를 확인한 뒤에 운영 환경에 적용합니다. ",
    0.67,
  ],
  ["a table of numbers", numberTable, 0.82],
  ["lines of hexadecimal hashes", hexLines, 0.9],
  [
    "Hindi",
    "तैनाती से पहले, पहले स्टेजिंग वातावरण में माइग्रेशन चलाएँ और परिणाम की जाँच करें, फिर उसे उत्पादन वातावरण में लागू करें। ",
    0.91,
  ],
];

describe("estimatedTokens", () => {
  it.each(MEASURED)(
    "estimates %s at or a little above what a tokenizer counted",
    (_, text, measured) => {
      const sample = fill(text);
      const perCharacter = estimatedTokens(sample) / sample.length;
      expect(perCharacter).toBeGreaterThanOrEqual(measured);
      expect(perCharacter).toBeLessThanOrEqual(measured * 1.3);
    },
  );

  it("counts a word as a token or two, a digit as one, and whitespace joined to what follows", () => {
    expect(estimatedTokens("")).toBe(0);
    expect(estimatedTokens("the")).toBe(1);
    expect(estimatedTokens("the cat")).toBe(2);
    expect(estimatedTokens("2026")).toBe(4);
    expect(estimatedTokens("a 1")).toBe(3);
    expect(estimatedTokens("a\n\nb")).toBe(3);
    expect(estimatedTokens("---")).toBe(2);
  });

  it("takes hostile text: lone surrogates, emoji, controls, and a long run of one letter", () => {
    expect(estimatedTokens("\ud800")).toBe(1);
    expect(estimatedTokens("x\udc00y")).toBe(3);
    expect(estimatedTokens("🎉🎉")).toBe(6);
    expect(estimatedTokens("\u0000\u0007")).toBe(1);
    expect(estimatedTokens("a".repeat(1_000_000))).toBe(200_000);
    expect(estimatedTokens("́".repeat(10))).toBeGreaterThan(0);
  });
});

describe("cutToTokens", () => {
  it.each(MEASURED)("cuts %s to the longest beginning within the tokens", (_, text) => {
    const long = fill(text, 20_000);
    for (const max of [1, 7, 100, 4096]) {
      const cut = cutToTokens(long, max);
      expect(long.startsWith(cut)).toBe(true);
      expect(estimatedTokens(cut)).toBeLessThanOrEqual(max);
      expect(estimatedTokens(long.slice(0, cut.length + 1))).toBeGreaterThan(max);
    }
  });

  it("gives a text within the tokens back whole, and never cuts through a surrogate pair", () => {
    expect(cutToTokens("Write three variants.", 4096)).toBe("Write three variants.");
    expect(cutToTokens("", 10)).toBe("");
    expect(cutToTokens("abc", 0)).toBe("");
    const emoji = "🎉".repeat(10);
    const cut = cutToTokens(emoji, 7);
    expect(cut).toBe("🎉🎉");
    expect(cut.length % 2).toBe(0);
  });
});
