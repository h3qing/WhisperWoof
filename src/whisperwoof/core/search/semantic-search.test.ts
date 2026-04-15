/**
 * Tests for Semantic Search — TF-IDF vectorization + cosine similarity.
 *
 * Imports `tokenize`, `termFrequency`, `inverseDocumentFrequency`,
 * `tfidfVector`, `cosineSimilarity`, and `STOP_WORDS` directly from
 * `bridge/semantic-search.js`. Source is load-safe (debugLogger + an
 * injectable db reference) and every pure helper is already exported,
 * so no `-pure.js` extraction was needed.
 *
 * The SQL-backed `semanticSearch(query, options)` and `findSimilar(id)`
 * functions delegate to these helpers after fetching rows — tests now
 * exercise the exact math the runtime uses.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  tokenize,
  termFrequency,
  inverseDocumentFrequency,
  tfidfVector,
  cosineSimilarity,
  STOP_WORDS,
} from "../../bridge/semantic-search";

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("removes stop words", () => {
    const tokens: string[] = tokenize("The quick brown fox jumps over the lazy dog");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("over");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
  });

  it("removes punctuation (and filters 'how' as a stop word)", () => {
    // "how" is in the production STOP_WORDS list, so the tokenizer drops
    // it even though punctuation was stripped correctly. "it" and "s"
    // also get dropped ("it" is a stop word, "s" is shorter than 2 chars).
    expect(tokenize("hello, world! how's it?")).toEqual(["hello", "world"]);
  });

  it("filters tokens shorter than 2 characters", () => {
    // "i" + "a" are stop words too, so this also asserts the stop list
    expect(tokenize("I a am ok go")).toEqual(["am", "ok", "go"]);
  });

  it("returns an empty array for null / empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });
});

describe("termFrequency", () => {
  it("computes document-length-normalized frequency", () => {
    const tf = termFrequency(["hello", "world", "hello"]) as Record<string, number>;
    expect(tf.hello).toBeCloseTo(2 / 3);
    expect(tf.world).toBeCloseTo(1 / 3);
  });

  it("returns 1 for a single-token document", () => {
    expect((termFrequency(["test"]) as Record<string, number>).test).toBe(1);
  });

  it("returns an empty map for an empty token list", () => {
    expect(termFrequency([])).toEqual({});
  });
});

describe("inverseDocumentFrequency", () => {
  it("assigns higher IDF to rarer terms", () => {
    const corpus = [
      ["hello", "world"],
      ["hello", "earth"],
      ["hello", "mars"],
    ];
    const idf = inverseDocumentFrequency(corpus) as Record<string, number>;
    expect(idf.mars!).toBeGreaterThan(idf.hello!);
  });

  it("assigns lower IDF to common terms", () => {
    const corpus = [["common"], ["common"], ["common"], ["rare"]];
    const idf = inverseDocumentFrequency(corpus) as Record<string, number>;
    expect(idf.common!).toBeLessThan(idf.rare!);
  });

  it("uses smoothed IDF (guaranteed > 0 for every term)", () => {
    const idf = inverseDocumentFrequency([["only"]]) as Record<string, number>;
    expect(idf.only).toBeGreaterThan(0);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = { hello: 1, world: 1 };
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity({ hello: 1 }, { world: 1 })).toBe(0);
  });

  it("returns a value in (0, 1) for partially overlapping vectors", () => {
    const sim = cosineSimilarity({ hello: 1, world: 1 }, { hello: 1, mars: 1 });
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("returns 0 for empty vectors (no divide-by-zero)", () => {
    expect(cosineSimilarity({}, {})).toBe(0);
    expect(cosineSimilarity({ a: 1 }, {})).toBe(0);
  });
});

describe("end-to-end similarity ranking", () => {
  const docs = [
    "We need to fix the bug in the login page authentication",
    "Schedule a meeting with the design team for next week",
    "The login authentication system has a critical error that needs fixing",
    "Buy groceries and pick up the kids from school",
  ];

  function searchDocs(query: string): number[] {
    const corpus = docs.map(tokenize);
    const queryTokens = tokenize(query);
    const allDocs = [...corpus, queryTokens];
    const idf = inverseDocumentFrequency(allDocs);
    const queryVec = tfidfVector(termFrequency(queryTokens), idf);

    return corpus.map((docTokens: string[]) => {
      const docVec = tfidfVector(termFrequency(docTokens), idf);
      return Math.round(cosineSimilarity(queryVec, docVec) * 1000) / 1000;
    });
  }

  it("ranks bug / auth queries above unrelated docs", () => {
    const scores = searchDocs("authentication bug fix");
    expect(scores[0]!).toBeGreaterThan(scores[1]!); // bug doc > meeting doc
    expect(scores[2]!).toBeGreaterThan(scores[1]!); // auth error doc > meeting doc
    expect(scores[0]!).toBeGreaterThan(scores[3]!); // bug doc > groceries doc
  });

  it("ranks meeting queries above other docs", () => {
    const scores = searchDocs("meeting schedule team");
    expect(scores[1]!).toBeGreaterThan(scores[0]!);
    expect(scores[1]!).toBeGreaterThan(scores[3]!);
  });

  it("scores unrelated queries low across the board", () => {
    const scores = searchDocs("quantum physics lecture notes");
    expect(scores.every((s: number) => s < 0.3)).toBe(true);
  });
});

describe("STOP_WORDS registry", () => {
  it("includes common English stop words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("is")).toBe(true);
  });

  it("does not include content words", () => {
    expect(STOP_WORDS.has("meeting")).toBe(false);
    expect(STOP_WORDS.has("bug")).toBe(false);
    expect(STOP_WORDS.has("design")).toBe(false);
  });
});
