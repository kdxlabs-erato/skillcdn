// How many tokens a text is to an embedding model, estimated without its tokenizer (ADR-0105).
// What a server takes to embed a text grows with its tokens, faster than with them, and the same
// number of characters is four times as many tokens in one script as in another: a word of English
// is a token or two, a syllable of Korean or a character of Chinese most of one, a digit one each,
// a letter of Devanagari more than one. A text is cut to what it is estimated to cost, so that no
// single text takes a server longer than the others do.
//
// The estimate follows how the tokenizers of the common embedding models split a text before they
// merge it: runs of letters, each digit alone, runs of symbols, whitespace mostly joined to what
// follows it. It is meant to come out at or above the count of those tokenizers for every script,
// as measured on one of them (the table in the ADR), never below by much: what it is for is a
// bound.

/** Tokens per letter of a run, by script; a run of letters is at least one token. */
function letterWeight(code: number): number {
  if (code < 0x80) return 0.2;
  if (code < 0x370) return 0.5; // Latin with accents, and the letters around it
  if (code < 0x590) return 0.4; // Greek, Cyrillic, Armenian
  if (code < 0x900) return 0.5; // Hebrew, Arabic, Syriac, Thaana
  if (code < 0x1000) return 1.2; // the scripts of India, Sri Lanka, Thailand, Laos, Tibet
  if (code < 0x10a0) return 1.2; // Myanmar
  if (code >= 0x1100 && code < 0x1200) return 0.9; // Hangul jamo
  if (code >= 0x1780 && code < 0x1800) return 1.2; // Khmer
  if (code >= 0x1e00 && code < 0x1f00) return 0.5; // more Latin with accents
  if (code >= 0x3130 && code < 0x3190) return 0.9; // Hangul compatibility jamo
  if (code >= 0x2e80 && code < 0xa000) return 0.7; // CJK ideographs, kana, bopomofo
  if (code >= 0xa960 && code < 0xa980) return 0.9; // Hangul jamo extended
  if (code >= 0xac00 && code < 0xd800) return 0.9; // Hangul syllables
  if (code >= 0xf900 && code < 0xfb00) return 0.7; // CJK compatibility ideographs
  if (code > 0xffff) return 2; // beyond the basic plane, several bytes to a byte-level model
  return 0.7;
}

/** A letter where the word holds digits too, as a hash or an identifier: rarely merged with another. */
const MIXED_LETTER = 0.75;
/** Tokens per symbol of a run; a run of symbols is at least one token. */
const SYMBOL_WEIGHT = 0.5;
/** A symbol beyond the basic plane, as most emoji are: several tokens of bytes. */
const ASTRAL_SYMBOL_WEIGHT = 3;

const LETTER = /^[\p{L}\p{M}]$/u;
const DIGIT = /^\p{Nd}$/u;
const SPACE = /^\s$/u;

type Kind = "letter" | "digit" | "space" | "symbol";

function kindOf(char: string, code: number): Kind {
  if (code < 0x80) {
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return "letter";
    if (code >= 0x30 && code <= 0x39) return "digit";
    if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return "space";
    return "symbol";
  }
  if (LETTER.test(char)) return "letter";
  if (DIGIT.test(char)) return "digit";
  if (SPACE.test(char)) return "space";
  return "symbol";
}

/** A run's weight as tokens: at least one, the rest rounded. */
const tokensOfRun = (weight: number): number => (weight <= 0 ? 0 : Math.max(1, Math.round(weight)));

/**
 * Walks `text` code point by code point and calls `at` with the estimate so far before each one,
 * counting the piece that code point closes; stops when `at` answers true. The estimate only grows.
 */
function walk(text: string, at: (index: number, tokens: number) => boolean): number {
  let closed = 0;
  // The open run of letters, of symbols or of whitespace, at most one of them at a time.
  let letters = 0;
  let mixedLetters = 0;
  let wordHasDigit = false;
  let symbols = 0;
  let spaces = 0;
  let newline = false;
  const closeLetters = (): void => {
    closed += tokensOfRun(wordHasDigit ? mixedLetters : letters);
    letters = 0;
    mixedLetters = 0;
  };
  const closeSymbols = (): void => {
    closed += tokensOfRun(symbols);
    symbols = 0;
  };
  // Whitespace joins the piece after it when it is one space before a word or a symbol; a run of
  // it, a line break, or a space before a digit is a token of its own.
  const closeSpaces = (next: Kind | undefined): void => {
    if (spaces > 0 && (spaces > 1 || newline || next === "digit" || next === undefined)) {
      closed += 1;
    }
    spaces = 0;
    newline = false;
  };
  const open = (): number =>
    tokensOfRun(wordHasDigit ? mixedLetters : letters) +
    tokensOfRun(symbols) +
    (spaces > 0 ? 1 : 0);
  let index = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const kind = kindOf(char, code);
    if (at(index, closed + open())) {
      return closed + open();
    }
    if (kind !== "letter" && kind !== "digit") {
      if (letters > 0) closeLetters();
      wordHasDigit = false;
    }
    if (kind !== "symbol" && symbols > 0) closeSymbols();
    if (kind !== "space") closeSpaces(kind);
    switch (kind) {
      case "letter": {
        const weight = letterWeight(code);
        letters += weight;
        mixedLetters += Math.max(weight, MIXED_LETTER);
        break;
      }
      case "digit":
        // A word that turns out to hold digits counts its letters as such, from its start.
        wordHasDigit = true;
        closed += 1;
        break;
      case "space":
        spaces += 1;
        if (char === "\n" || char === "\r") newline = true;
        break;
      case "symbol":
        symbols += code > 0xffff ? ASTRAL_SYMBOL_WEIGHT : SYMBOL_WEIGHT;
        break;
    }
    index += char.length;
  }
  if (letters > 0) closeLetters();
  if (symbols > 0) closeSymbols();
  closeSpaces(undefined);
  at(index, closed);
  return closed;
}

/** How many tokens `text` is estimated to be to an embedding model, at or above what one counts. */
export function estimatedTokens(text: string): number {
  return walk(text, () => false);
}

/**
 * `text` cut to its longest beginning of at most `maxTokens` estimated tokens, never through a
 * code point; the text itself when it is within them.
 */
export function cutToTokens(text: string, maxTokens: number): string {
  let end = 0;
  walk(text, (index, tokens) => {
    if (tokens > maxTokens) {
      return true;
    }
    end = index;
    return false;
  });
  return text.slice(0, end);
}
