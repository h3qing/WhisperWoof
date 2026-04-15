/**
 * Tests for Backtrack Correction — mid-sentence self-correction detection.
 *
 * Imports `detectBacktrack`, `hasBacktrack`, and `CORRECTION_SIGNALS`
 * directly from the real source module at bridge/backtrack.js. The
 * LLM-side `applyBacktrackCorrection` is a network call wrapped around
 * these detectors and is out of scope here.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { detectBacktrack, hasBacktrack, CORRECTION_SIGNALS } from "../../bridge/backtrack";

describe("hasBacktrack — correction signal detection", () => {
  it('detects "no wait" corrections', () => {
    expect(hasBacktrack("Let's meet tomorrow, no wait, Friday instead")).toBe(true);
    expect(hasBacktrack("Send it to John, no, wait, send it to Sarah")).toBe(true);
  });

  it('detects "actually" corrections', () => {
    expect(hasBacktrack("Send it to John, actually change it to Sarah")).toBe(true);
    expect(hasBacktrack("The budget is ten thousand actually no twelve thousand")).toBe(true);
  });

  it('detects "I mean" corrections', () => {
    expect(hasBacktrack("It costs fifty dollars, I mean sixty dollars")).toBe(true);
    expect(hasBacktrack("We need five, sorry I meant six")).toBe(true);
  });

  it('detects "scratch that" corrections', () => {
    expect(hasBacktrack("Buy milk and eggs, scratch that, just milk")).toBe(true);
    expect(hasBacktrack("Add a paragraph about pricing, delete that, skip it")).toBe(true);
    expect(hasBacktrack("Send the email, never mind, save as draft")).toBe(true);
  });

  it('detects "not X but Y" pattern', () => {
    expect(hasBacktrack("not Monday but Tuesday")).toBe(true);
    expect(hasBacktrack("not the blue one, rather the red one")).toBe(true);
  });

  it('detects "change that to" pattern', () => {
    expect(hasBacktrack("change that to Friday")).toBe(true);
    expect(hasBacktrack("replace tomorrow with next week")).toBe(true);
  });

  it('detects "or rather / actually" pattern', () => {
    expect(hasBacktrack("Send it today, or rather tomorrow morning")).toBe(true);
    expect(hasBacktrack("The meeting is at 3, well actually 4pm")).toBe(true);
  });

  it('detects "wait / hold on" pattern', () => {
    expect(hasBacktrack("wait, let me rethink that")).toBe(true);
    expect(hasBacktrack("hold on, actually make it 5pm")).toBe(true);
  });

  it("returns empty for normal speech", () => {
    expect(hasBacktrack("I need to buy groceries for dinner")).toBe(false);
    expect(hasBacktrack("The meeting is at 3pm in the conference room")).toBe(false);
    expect(hasBacktrack("Please send the report to Sarah by Friday")).toBe(false);
  });

  it("returns empty for short / null input", () => {
    expect(hasBacktrack(null)).toBe(false);
    expect(hasBacktrack("")).toBe(false);
    expect(hasBacktrack("hello")).toBe(false);
  });
});

describe("detectBacktrack — structured match output", () => {
  it("returns matches with signal + index for each detected pattern", () => {
    const matches = detectBacktrack("no wait, I mean, scratch that, just forget it");
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      expect(typeof m.signal).toBe("string");
      expect(typeof m.index).toBe("number");
      expect(m.index).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty array (not null) for no match", () => {
    expect(detectBacktrack("I need to pick up groceries and walk the dog later today")).toEqual([]);
  });
});

describe("CORRECTION_SIGNALS registry", () => {
  it("has 8 correction signal patterns", () => {
    expect(CORRECTION_SIGNALS).toHaveLength(8);
  });

  it("all patterns are case-insensitive", () => {
    expect(hasBacktrack("NO WAIT, CHANGE THAT")).toBe(true);
    expect(hasBacktrack("I MEAN something else")).toBe(true);
    expect(hasBacktrack("SCRATCH THAT for sure")).toBe(true);
  });
});

describe("false-positive guards", () => {
  it('does not match "actually" in non-correction context', () => {
    expect(hasBacktrack("I actually went to the store yesterday")).toBe(false);
  });

  it('does not match "wait" in non-correction context', () => {
    expect(hasBacktrack("Please wait for the results")).toBe(false);
  });

  it("detects correction at end of sentence", () => {
    expect(hasBacktrack("The total is five hundred, I mean six hundred")).toBe(true);
  });

  it("detects correction at start of sentence", () => {
    expect(hasBacktrack("Scratch that, let's start over with a different plan")).toBe(true);
  });
});
