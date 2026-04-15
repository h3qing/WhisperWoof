/**
 * Tests for Voice Snippets — trigger phrase expansion.
 *
 * Imports `matchSnippet` and `simpleEditDistance` directly from the pure
 * source module at src/whisperwoof/bridge/snippets-pure.js, which is the
 * same implementation the production `expandSnippet` wrapper delegates to.
 * File I/O and usage tracking wrap this in snippets.js and are out of scope.
 */

import { describe, it, expect } from "vitest";
import { matchSnippet, simpleEditDistance } from "../../bridge/snippets-pure";

interface Snippet {
  id: string;
  trigger: string;
  body: string;
  usageCount: number;
}

const TEST_SNIPPETS: Snippet[] = [
  { id: "1", trigger: "my email", body: "heqing@example.com", usageCount: 5 },
  { id: "2", trigger: "standup update", body: "Yesterday: ...\nToday: ...\nBlockers: None", usageCount: 3 },
  { id: "3", trigger: "email sign off", body: "Best regards,\nHeqing", usageCount: 2 },
  { id: "4", trigger: "my address", body: "123 Main St, SF, CA 94102", usageCount: 0 },
  { id: "5", trigger: "hi", body: "Hello!", usageCount: 0 },
];

describe("matchSnippet — exact matching", () => {
  it("matches exact trigger (case-insensitive)", () => {
    const result = matchSnippet("my email", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.body).toBe("heqing@example.com");
    expect(result?.matchType).toBe("exact");
  });

  it("matches with different case", () => {
    const result = matchSnippet("My Email", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.body).toBe("heqing@example.com");
  });

  it('matches "standup update"', () => {
    const result = matchSnippet("standup update", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.trigger).toBe("standup update");
  });

  it("matches short triggers", () => {
    const result = matchSnippet("hi", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.body).toBe("Hello!");
  });

  it("returns the id of the matched snippet so callers can record usage", () => {
    const result = matchSnippet("standup update", TEST_SNIPPETS);
    expect(result?.id).toBe("2");
  });
});

describe("matchSnippet — prefix matching", () => {
  it("matches when input starts with trigger", () => {
    const result = matchSnippet("my email please", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.body).toBe("heqing@example.com");
    expect(result?.matchType).toBe("prefix");
  });

  it("picks longest trigger on overlap", () => {
    const snippets: Snippet[] = [
      { id: "a", trigger: "my", body: "short", usageCount: 0 },
      { id: "b", trigger: "my email", body: "full email", usageCount: 0 },
    ];
    const result = matchSnippet("my email now", snippets);
    expect(result?.body).toBe("full email");
  });
});

describe("matchSnippet — fuzzy matching", () => {
  it("matches 1 char off for long triggers", () => {
    const result = matchSnippet("standup updatx", TEST_SNIPPETS);
    expect(result?.matched).toBe(true);
    expect(result?.trigger).toBe("standup update");
    expect(result?.matchType).toBe("fuzzy");
  });

  it("does NOT fuzzy match short triggers (< 5 chars)", () => {
    const result = matchSnippet("hj", TEST_SNIPPETS);
    expect(result).toBeNull();
  });

  it("does NOT match 2+ chars off", () => {
    const result = matchSnippet("standup updxyz", TEST_SNIPPETS);
    expect(result).toBeNull();
  });
});

describe("matchSnippet — no match", () => {
  it("returns null for unknown text", () => {
    expect(matchSnippet("buy groceries", TEST_SNIPPETS)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchSnippet("", TEST_SNIPPETS)).toBeNull();
    expect(matchSnippet(null, TEST_SNIPPETS)).toBeNull();
  });

  it("returns null for single char", () => {
    expect(matchSnippet("x", TEST_SNIPPETS)).toBeNull();
  });

  it("returns null for empty snippet list", () => {
    expect(matchSnippet("my email", [])).toBeNull();
  });
});

describe("simpleEditDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(simpleEditDistance("hello", "hello")).toBe(0);
  });

  it("handles single substitution", () => {
    expect(simpleEditDistance("cat", "car")).toBe(1);
  });

  it("handles insertion", () => {
    expect(simpleEditDistance("cat", "cats")).toBe(1);
  });

  it("handles deletion", () => {
    expect(simpleEditDistance("cats", "cat")).toBe(1);
  });

  it("handles empty strings", () => {
    expect(simpleEditDistance("", "hello")).toBe(5);
    expect(simpleEditDistance("hello", "")).toBe(5);
  });

  it("short-circuits on large length difference", () => {
    expect(simpleEditDistance("hi", "hello world")).toBe(9);
  });
});
