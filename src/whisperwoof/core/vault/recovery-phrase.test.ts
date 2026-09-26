import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  PHRASE_WORD_COUNT,
  entropyToWords,
  wordsToEntropy,
  parsePhrase,
  pickConfirmIndexes,
} = require("../../bridge/vault/recovery-phrase-pure.js");

const hex = (h: string) => Buffer.from(h, "hex");

// Official BIP39 test vectors (128-bit entropy).
const VECTORS: [string, string][] = [
  ["00000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"],
  ["7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank yellow"],
  ["80808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"],
  ["ffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"],
];

describe("recovery phrase (BIP39, 12 words)", () => {
  it("encodes the official test vectors", () => {
    for (const [entropy, phrase] of VECTORS) {
      expect(entropyToWords(hex(entropy)).join(" ")).toBe(phrase);
    }
  });

  it("decodes the official test vectors back to their entropy", () => {
    for (const [entropy, phrase] of VECTORS) {
      expect(wordsToEntropy(phrase.split(" ")).toString("hex")).toBe(entropy);
    }
  });

  it("uses 12 words", () => {
    expect(PHRASE_WORD_COUNT).toBe(12);
  });

  it("rejects entropy that is not 16 bytes", () => {
    expect(() => entropyToWords(Buffer.alloc(32))).toThrow();
  });

  it("rejects a phrase whose checksum is wrong (one word swapped)", () => {
    const words = VECTORS[1][1].split(" ");
    const swapped = [...words.slice(0, 11), "zoo"];
    expect(() => wordsToEntropy(swapped)).toThrow(/checksum/i);
  });

  it("rejects unknown words and the wrong word count", () => {
    expect(() => wordsToEntropy(VECTORS[0][1].replace("about", "aboutt").split(" "))).toThrow(/word/i);
    expect(() => wordsToEntropy(VECTORS[0][1].split(" ").slice(0, 11))).toThrow(/12/);
  });
});

describe("parsePhrase (what the user types)", () => {
  it("accepts extra spaces, newlines, capitals and numbering", () => {
    const typed = "  1. Legal  2. winner\n3. THANK 4. year 5. wave 6. sausage 7. worth 8. useful 9. legal 10. winner 11. thank 12. yellow ";
    expect(parsePhrase(typed).toString("hex")).toBe("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f");
  });

  it("accepts the first four letters of each word", () => {
    const typed = "lega winn than year wave saus wort usef lega winn than yell";
    expect(parsePhrase(typed).toString("hex")).toBe("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f");
  });

  it("says which word it doesn't know", () => {
    expect(() => parsePhrase("legal winner thank year wave sausage worth useful legal winner thank yelow")).toThrow(/12/);
    expect(() => parsePhrase("legal winner thank year wave sausage worth useful legal winner thank yelow")).toThrow(/yelow/);
  });
});

describe("pickConfirmIndexes", () => {
  it("picks 3 distinct, sorted positions from 0..11", () => {
    for (let i = 0; i < 50; i++) {
      const picks = pickConfirmIndexes(3);
      expect(picks).toHaveLength(3);
      expect(new Set(picks).size).toBe(3);
      expect([...picks].sort((a: number, b: number) => a - b)).toEqual(picks);
      for (const p of picks) expect(p >= 0 && p < 12).toBe(true);
    }
  });
});
