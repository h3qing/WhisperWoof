/**
 * Tests for Custom Vocabulary pure logic.
 *
 * Imports `filterVocabulary`, `isDuplicateWord`, `flattenSttHints`,
 * `computeVocabularyStats`, `planVocabularyImport`, and `MAX_ENTRIES`
 * directly from `bridge/vocabulary-pure.js`. These are the same
 * helpers production `getVocabulary` / `addWord` / `importWords` /
 * `getSttHints` / `getVocabularyStats` delegate to after fetching
 * data from disk.
 *
 * On-disk persistence, the in-memory cache, and per-app usage
 * tracking live in `bridge/vocabulary.js` and are out of scope here.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_ENTRIES,
  filterVocabulary,
  isDuplicateWord,
  flattenSttHints,
  computeVocabularyStats,
  planVocabularyImport,
} from "../../bridge/vocabulary-pure";

interface VocabEntry {
  id: string;
  word: string;
  category: string;
  alternatives: string[];
  source: string;
  usageCount: number;
  createdAt?: string;
  appContexts?: Record<string, { count: number; firstSeen: string; lastSeen: string }>;
}

const SAMPLE: VocabEntry[] = [
  { id: "1", word: "WhisperWoof", category: "technical", alternatives: ["whisper woof", "whisperwulf"], source: "manual", usageCount: 15 },
  { id: "2", word: "Heqing", category: "names", alternatives: ["he ching", "he king"], source: "manual", usageCount: 8 },
  { id: "3", word: "Ollama", category: "technical", alternatives: ["oh llama", "o lama"], source: "auto-learn", usageCount: 12 },
  { id: "4", word: "LGTM", category: "abbreviation", alternatives: ["looks good to me"], source: "manual", usageCount: 3 },
  { id: "5", word: "Mando", category: "names", alternatives: ["man doe"], source: "manual", usageCount: 20 },
];

describe("filterVocabulary", () => {
  it("filters by exact category match", () => {
    expect(filterVocabulary(SAMPLE, { category: "technical" })).toHaveLength(2);
    expect(filterVocabulary(SAMPLE, { category: "names" })).toHaveLength(2);
    expect(filterVocabulary(SAMPLE, { category: "abbreviation" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { category: "medical" })).toHaveLength(0);
  });

  it("searches words and alternatives case-insensitively", () => {
    expect(filterVocabulary(SAMPLE, { search: "whisper" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "Heq" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "he ching" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "oh llama" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "WHISPERWOOF" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "lgtm" })).toHaveLength(1);
    expect(filterVocabulary(SAMPLE, { search: "xyz123" })).toHaveLength(0);
  });

  it("sorts by usage descending when sortBy: 'usage'", () => {
    const sorted: VocabEntry[] = filterVocabulary(SAMPLE, { sortBy: "usage" });
    expect(sorted[0]!.word).toBe("Mando"); // 20
    expect(sorted[1]!.word).toBe("WhisperWoof"); // 15
    expect(sorted[2]!.word).toBe("Ollama"); // 12
  });

  it("defaults to alphabetical sort", () => {
    const sorted: VocabEntry[] = filterVocabulary(SAMPLE);
    const words = sorted.map((e) => e.word);
    expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b)));
  });

  it("does not mutate the input array", () => {
    const copy = [...SAMPLE];
    filterVocabulary(SAMPLE, { sortBy: "usage" });
    expect(SAMPLE).toEqual(copy);
  });

  it("returns empty array for null / non-array input", () => {
    expect(filterVocabulary(null)).toEqual([]);
    expect(filterVocabulary(undefined)).toEqual([]);
  });
});

describe("isDuplicateWord", () => {
  it("detects duplicates case-insensitively", () => {
    expect(isDuplicateWord(SAMPLE, "WhisperWoof")).toBe(true);
    expect(isDuplicateWord(SAMPLE, "whisperwoof")).toBe(true);
    expect(isDuplicateWord(SAMPLE, "WHISPERWOOF")).toBe(true);
  });

  it("allows new unique words", () => {
    expect(isDuplicateWord(SAMPLE, "NewWord")).toBe(false);
    expect(isDuplicateWord(SAMPLE, "Vitest")).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(isDuplicateWord(SAMPLE, "  whisperwoof  ")).toBe(true);
  });

  it("returns false for empty / nullish input", () => {
    expect(isDuplicateWord(SAMPLE, "")).toBe(false);
    expect(isDuplicateWord(SAMPLE, null)).toBe(false);
    expect(isDuplicateWord(SAMPLE, undefined)).toBe(false);
  });
});

describe("flattenSttHints", () => {
  it("includes every word and alternative", () => {
    const hints: string[] = flattenSttHints(SAMPLE);
    expect(hints).toContain("WhisperWoof");
    expect(hints).toContain("whisper woof");
    expect(hints).toContain("Heqing");
    expect(hints).toContain("he ching");
    expect(hints).toContain("LGTM");
  });

  it("deduplicates when word and alternative collide", () => {
    const withDup: VocabEntry[] = [
      { id: "1", word: "test", category: "general", alternatives: ["test"], source: "manual", usageCount: 0 },
    ];
    const hints: string[] = flattenSttHints(withDup);
    expect(hints.filter((h) => h === "test")).toHaveLength(1);
  });

  it("boosts app-specific entries to the front when bundleId is provided", () => {
    const appContexts = {
      "com.microsoft.VSCode": { count: 10, firstSeen: "2026-04-01T00:00:00Z", lastSeen: "2026-04-10T00:00:00Z" },
    };
    const withContext: VocabEntry[] = [
      { ...SAMPLE[0]! },
      { ...SAMPLE[1]! },
      { ...SAMPLE[2]!, appContexts },
    ];
    const hints: string[] = flattenSttHints(withContext, "com.microsoft.VSCode");
    // Ollama (the app-specific entry) should land before WhisperWoof
    expect(hints.indexOf("Ollama")).toBeLessThan(hints.indexOf("WhisperWoof"));
  });

  it("returns empty for empty or null input", () => {
    expect(flattenSttHints([])).toHaveLength(0);
    expect(flattenSttHints(null)).toHaveLength(0);
  });
});

describe("computeVocabularyStats", () => {
  it("counts entries per category", () => {
    const stats = computeVocabularyStats(SAMPLE);
    expect(stats.total).toBe(5);
    expect((stats.categories as Record<string, number>).technical).toBe(2);
    expect((stats.categories as Record<string, number>).names).toBe(2);
    expect((stats.categories as Record<string, number>).abbreviation).toBe(1);
  });

  it("returns the top 5 most-used words by usageCount", () => {
    const stats = computeVocabularyStats(SAMPLE);
    expect(stats.topUsed).toHaveLength(5);
    expect(stats.topUsed[0]!.word).toBe("Mando"); // 20
    expect(stats.topUsed[1]!.word).toBe("WhisperWoof"); // 15
    expect(stats.topUsed[2]!.word).toBe("Ollama"); // 12
  });

  it("counts source breakdown (manual vs auto-learned)", () => {
    const stats = computeVocabularyStats(SAMPLE);
    expect(stats.manual).toBe(4);
    expect(stats.autoLearned).toBe(1);
  });

  it("exposes the MAX_ENTRIES cap", () => {
    const stats = computeVocabularyStats(SAMPLE);
    expect(stats.max).toBe(MAX_ENTRIES);
  });

  it("handles empty and null input", () => {
    expect(computeVocabularyStats([]).total).toBe(0);
    expect(computeVocabularyStats([]).topUsed).toHaveLength(0);
    expect(computeVocabularyStats(null).total).toBe(0);
  });
});

describe("planVocabularyImport", () => {
  const FIXED_NOW = "2026-04-11T12:00:00.000Z";
  let counter = 0;
  const idFactory = () => `test-id-${counter++}`;

  it("adds new words while skipping duplicates", () => {
    counter = 0;
    const { additions, skipped } = planVocabularyImport(
      SAMPLE,
      ["NewWord", "AnotherWord", "WhisperWoof"], // one duplicate
      "general",
      FIXED_NOW,
      idFactory,
    );
    expect(additions).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(additions.map((a: VocabEntry) => a.word)).toEqual(["NewWord", "AnotherWord"]);
  });

  it("skips empty / whitespace-only strings", () => {
    counter = 0;
    const { additions, skipped } = planVocabularyImport([], ["", "  ", "valid"], "general", FIXED_NOW, idFactory);
    expect(additions).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("stamps imports with source='import' and the given category", () => {
    counter = 0;
    const { additions } = planVocabularyImport([], ["alpha", "beta"], "technical", FIXED_NOW, idFactory);
    for (const a of additions as VocabEntry[]) {
      expect(a.source).toBe("import");
      expect(a.category).toBe("technical");
      expect(a.createdAt).toBe(FIXED_NOW);
    }
  });

  it("accepts object-form entries and honors their per-entry category / alternatives", () => {
    counter = 0;
    const { additions } = planVocabularyImport(
      [],
      [{ word: "Foo", category: "names", alternatives: ["foo bar"] }],
      "general",
      FIXED_NOW,
      idFactory,
    );
    expect(additions).toHaveLength(1);
    expect(additions[0]!.category).toBe("names");
    expect(additions[0]!.alternatives).toEqual(["foo bar"]);
  });

  it("stops adding once MAX_ENTRIES is reached", () => {
    counter = 0;
    const fullList = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
      id: `e${i}`,
      word: `word-${i}`,
      category: "general",
      alternatives: [],
      source: "manual",
      usageCount: 0,
    }));
    const { additions, skipped } = planVocabularyImport(
      fullList,
      ["overflow-1", "overflow-2"],
      "general",
      FIXED_NOW,
      idFactory,
    );
    expect(additions).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("returns empty result for non-array input", () => {
    const result = planVocabularyImport([], "not an array" as unknown as string[], "general", FIXED_NOW, idFactory);
    expect(result.additions).toEqual([]);
    expect(result.skipped).toBe(0);
  });
});
