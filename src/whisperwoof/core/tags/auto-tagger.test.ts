/**
 * Tests for Smart Auto-Tagger — keyword rule matching.
 *
 * Imports `suggestTagsByKeywords` and `KEYWORD_RULES` directly from
 * `bridge/auto-tagger.js`. Source is load-safe (only requires debugLogger)
 * and already exports everything needed, so no `-pure.js` extraction
 * was required — same pattern as `context-detector` / `voice-commands`
 * / `smart-reply` from earlier batches.
 *
 * The LLM-backed `suggestTagsByLlm` / `autoTag` paths are network calls
 * and remain out of scope.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { suggestTagsByKeywords, KEYWORD_RULES } from "../../bridge/auto-tagger";

interface TagSuggestion {
  tag: string;
  score: number;
  matchedKeywords: string[];
  source: string;
}

describe("suggestTagsByKeywords", () => {
  it('detects meeting-related entries and returns matched keywords', () => {
    const tags = suggestTagsByKeywords("Notes from the standup meeting this morning with the team") as TagSuggestion[];
    const meetingTag = tags.find((t) => t.tag === "meeting");
    expect(meetingTag).toBeDefined();
    expect(meetingTag!.matchedKeywords).toContain("meeting");
    expect(meetingTag!.matchedKeywords).toContain("standup");
    expect(meetingTag!.source).toBe("rule");
  });

  it("detects task-related entries", () => {
    const tags = suggestTagsByKeywords("I need to finish the report by the deadline tomorrow") as TagSuggestion[];
    const taskTag = tags.find((t) => t.tag === "task");
    expect(taskTag).toBeDefined();
    expect(taskTag!.matchedKeywords).toContain("need to");
    expect(taskTag!.matchedKeywords).toContain("deadline");
  });

  it("detects bug-related entries", () => {
    const tags = suggestTagsByKeywords("There's a bug in the login page, it's not working and crashes") as TagSuggestion[];
    const bugTag = tags.find((t) => t.tag === "bug");
    expect(bugTag).toBeDefined();
    expect(bugTag!.matchedKeywords.length).toBeGreaterThanOrEqual(2);
  });

  it("detects code-related entries", () => {
    const tags = suggestTagsByKeywords(
      "Create a new component and deploy it to the api endpoint",
    ) as TagSuggestion[];
    expect(tags.find((t) => t.tag === "code")).toBeDefined();
  });

  it("detects decision entries", () => {
    const tags = suggestTagsByKeywords(
      "We decided to go with the new vendor, it's confirmed and approved",
    ) as TagSuggestion[];
    expect(tags.find((t) => t.tag === "decision")).toBeDefined();
  });

  it("detects personal entries", () => {
    const tags = suggestTagsByKeywords("Remind me to pick up groceries and call the dentist") as TagSuggestion[];
    expect(tags.find((t) => t.tag === "personal")).toBeDefined();
  });

  it("returns multiple matching categories for mixed text", () => {
    const tags = suggestTagsByKeywords(
      "In the meeting we decided to fix the bug in the api endpoint",
    ) as TagSuggestion[];
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags.map((t) => t.tag)).toContain("meeting");
  });

  it("returns empty for short or empty text", () => {
    expect(suggestTagsByKeywords("hi")).toHaveLength(0);
    expect(suggestTagsByKeywords("")).toHaveLength(0);
    expect(suggestTagsByKeywords(null as unknown as string)).toHaveLength(0);
  });

  it("caps suggestions at 5", () => {
    const tags = suggestTagsByKeywords(
      "meeting task idea decision question bug personal code finance design budget api fix standup",
    ) as TagSuggestion[];
    expect(tags.length).toBeLessThanOrEqual(5);
  });
});

describe("suggestTagsByKeywords — existing user tags", () => {
  it("matches existing tag names that appear in the text", () => {
    const tags = suggestTagsByKeywords(
      "This is about the WhisperWoof project launch",
      ["WhisperWoof", "launch", "marketing"],
    ) as TagSuggestion[];
    const existing = tags.filter((t) => t.source === "existing");
    expect(existing.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores existing tag names shorter than 3 characters", () => {
    const tags = suggestTagsByKeywords("This is a UI test", ["UI", "test-long-enough"]) as TagSuggestion[];
    const existing = tags.filter((t) => t.source === "existing");
    expect(existing.every((t) => t.tag.length >= 3)).toBe(true);
  });

  it("is case-insensitive when matching existing tag names", () => {
    const tags = suggestTagsByKeywords("working on the FRONTEND redesign", ["frontend"]) as TagSuggestion[];
    expect(tags.find((t) => t.tag === "frontend")).toBeDefined();
  });
});

describe("suggestTagsByKeywords — scoring", () => {
  it("scales score with the fraction of keywords hit", () => {
    const tags = suggestTagsByKeywords("meeting standup sync with call discussion about agenda") as TagSuggestion[];
    const meetingTag = tags.find((t) => t.tag === "meeting");
    expect(meetingTag!.score).toBeGreaterThan(0.5);
  });

  it("sorts results by score descending", () => {
    const tags = suggestTagsByKeywords("meeting task bug code design") as TagSuggestion[];
    for (let i = 1; i < tags.length; i++) {
      expect(tags[i]!.score).toBeLessThanOrEqual(tags[i - 1]!.score);
    }
  });

  it("gives existing user-tag matches a fixed score of 0.8", () => {
    const tags = suggestTagsByKeywords("working on frontend", ["frontend"]) as TagSuggestion[];
    expect(tags.find((t) => t.source === "existing")?.score).toBe(0.8);
  });
});

describe("KEYWORD_RULES registry", () => {
  it("covers the 10 documented categories", () => {
    expect(Object.keys(KEYWORD_RULES)).toHaveLength(10);
  });

  it("every category has at least 5 keywords", () => {
    for (const [, keywords] of Object.entries(KEYWORD_RULES) as [string, string[]][]) {
      expect(keywords.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("every keyword is lowercase so matches are case-insensitive", () => {
    for (const [, keywords] of Object.entries(KEYWORD_RULES) as [string, string[]][]) {
      for (const kw of keywords) {
        expect(kw).toBe(kw.toLowerCase());
      }
    }
  });
});
