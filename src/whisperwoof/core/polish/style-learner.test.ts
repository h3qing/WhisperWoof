/**
 * Tests for the Adaptive Style Learner pure logic.
 *
 * Imports `editDistance`, `shouldRecordStyleExample`, and
 * `buildPromptFromExamples` directly from the real source module at
 * src/whisperwoof/bridge/style-learner-pure.js. The on-disk persistence
 * and example pruning live in style-learner.js and are out of scope here.
 */

import { describe, it, expect } from "vitest";
import {
  editDistance,
  shouldRecordStyleExample,
  buildPromptFromExamples,
  MAX_PROMPT_EXAMPLES,
} from "../../bridge/style-learner-pure";

interface StyleExample {
  polished: string;
  edited: string;
  timestamp: string;
  editRatio: number;
}

describe("editDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(editDistance("hello", "hello")).toBe(0);
  });

  it("returns length for empty string", () => {
    expect(editDistance("", "hello")).toBe(5);
    expect(editDistance("hello", "")).toBe(5);
  });

  it("calculates simple substitutions", () => {
    expect(editDistance("cat", "car")).toBe(1);
    expect(editDistance("cat", "dog")).toBe(3);
  });

  it("handles insertions and deletions", () => {
    expect(editDistance("cat", "cats")).toBe(1);
    expect(editDistance("cats", "cat")).toBe(1);
  });

  it("handles mixed operations", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("shouldRecordStyleExample", () => {
  it("records meaningful edits (>5% change)", () => {
    const polished = "I need to go to the store and pick up groceries for dinner tonight.";
    const edited = "I need to go to the store and pick up groceries for dinner.";
    expect(shouldRecordStyleExample(polished, edited)).toBe(true);
  });

  it("skips identical text", () => {
    expect(shouldRecordStyleExample("hello world", "hello world")).toBe(false);
  });

  it("skips trivial edits (<5% change)", () => {
    const long = "This is a very long sentence that the user spoke into the microphone and it was polished.";
    const tiny = "This is a very long sentence that the user spoke into the microphone and it was polished";
    expect(shouldRecordStyleExample(long, tiny)).toBe(false);
  });

  it("skips total rewrites (>80% different)", () => {
    expect(shouldRecordStyleExample("Hello world foo bar baz qux", "ZYXWVUTSRQ completely other words")).toBe(false);
  });

  it("skips empty input", () => {
    expect(shouldRecordStyleExample("", "hello")).toBe(false);
    expect(shouldRecordStyleExample("hello", "")).toBe(false);
  });

  it("skips very short text (<10 chars)", () => {
    expect(shouldRecordStyleExample("hi there", "hey there")).toBe(false);
  });

  it("records style changes (formal → casual)", () => {
    const polished = "I would like to schedule a meeting to discuss the project timeline.";
    const edited = "Let's set up a meeting to talk about the project timeline.";
    expect(shouldRecordStyleExample(polished, edited)).toBe(true);
  });
});

describe("buildPromptFromExamples", () => {
  const examples: StyleExample[] = [
    {
      polished: "I need to complete the report by Friday.",
      edited: "Need to finish the report by Friday.",
      timestamp: "2026-03-29T10:00:00Z",
      editRatio: 0.15,
    },
    {
      polished: "Please ensure all tasks are completed before the deadline.",
      edited: "Make sure everything's done before the deadline.",
      timestamp: "2026-03-30T10:00:00Z",
      editRatio: 0.3,
    },
  ];

  it("returns empty string for no examples", () => {
    expect(buildPromptFromExamples("hello", [])).toBe("");
  });

  it("includes examples in the prompt", () => {
    const prompt = buildPromptFromExamples("I should finish the work", examples);
    expect(prompt).toContain("user has previously edited");
    expect(prompt).toContain("Before:");
    expect(prompt).toContain("After:");
  });

  it("limits to MAX_PROMPT_EXAMPLES", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      polished: `Example polished text number ${i} that is long enough`,
      edited: `Example edited text number ${i} that is also long enough`,
      timestamp: new Date().toISOString(),
      editRatio: 0.2,
    }));
    const prompt = buildPromptFromExamples("test input", many);
    const exampleCount = (prompt.match(/Example:/g) || []).length;
    expect(exampleCount).toBeLessThanOrEqual(MAX_PROMPT_EXAMPLES);
  });

  it("prefers examples with similar length to input", () => {
    const varied: StyleExample[] = [
      { polished: "short", edited: "brief", timestamp: "2026-01-01T00:00:00Z", editRatio: 0.2 },
      {
        polished: "This is a medium length sentence that should match better with similar inputs.",
        edited: "This is a medium sentence that matches better with similar inputs.",
        timestamp: "2026-01-02T00:00:00Z",
        editRatio: 0.15,
      },
    ];
    const prompt = buildPromptFromExamples(
      "This is a medium length input sentence for testing.",
      varied,
    );
    expect(prompt).toContain("medium");
  });
});
