/**
 * Tests for Intent Capture — rambling detection and output modes.
 *
 * Imports `detectRambling`, `getIntentPrompt`, `getOutputModes`,
 * `RAMBLING_SIGNALS`, and `OUTPUT_MODES` directly from
 * `bridge/intent-capture.js`. Source is load-safe (only requires
 * debugLogger) and already exports everything needed — no `-pure.js`
 * extraction.
 *
 * The LLM extraction path (`extractIntent`) is a network call and
 * remains out of scope for these unit tests.
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
  detectRambling,
  getIntentPrompt,
  getOutputModes,
  RAMBLING_SIGNALS,
  OUTPUT_MODES,
} from "../../bridge/intent-capture";

describe("detectRambling", () => {
  it("detects heavy rambling with multi-signal text", () => {
    const rambling =
      "so basically I was thinking we should probably maybe look into, you know, changing the deployment to like happen on Fridays instead of Mondays because I think, I mean I guess the release schedule kind of sort of works better that way, but anyway the thing is we might want to actually consider it";
    const result = detectRambling(rambling);
    expect(result.isRambling).toBe(true);
    expect(result.score).toBeGreaterThan(0.3);
  });

  it("detects moderate rambling", () => {
    const moderate =
      "I think we should probably change the meeting time, you know, because like the current time doesn't work for everyone, so maybe we could move it to afternoon";
    const result = detectRambling(moderate);
    expect(result.isRambling).toBe(true);
  });

  it("does not flag clean, direct speech", () => {
    const clean = "Change the deployment schedule from Monday to Friday to align with the release cycle.";
    const result = detectRambling(clean);
    expect(result.isRambling).toBe(false);
    expect(result.score).toBeLessThan(0.25);
  });

  it("does not flag direct instructions", () => {
    const direct =
      "Send the quarterly report to the finance team by end of day Friday. Include the updated projections.";
    const result = detectRambling(direct);
    expect(result.isRambling).toBe(false);
  });

  it("counts hedging signals", () => {
    const text = "I think we should probably maybe consider perhaps looking into this, I guess";
    expect(detectRambling(text).signals.hedging).toBeGreaterThan(2);
  });

  it("counts filler signals", () => {
    const text = "so um basically like you know I was um thinking about like this thing right";
    expect(detectRambling(text).signals.fillers).toBeGreaterThan(3);
  });

  it("counts tangent signals", () => {
    const text =
      "We need to fix the bug, by the way speaking of bugs, which reminds me about the other issue, oh and also the deployment";
    expect(detectRambling(text).signals.tangents).toBeGreaterThan(1);
  });

  it("returns score 0 for text below the min-length threshold", () => {
    expect(detectRambling("hello")).toEqual({ score: 0, signals: {}, isRambling: false });
  });

  it("returns score 0 for null / empty input", () => {
    expect(detectRambling(null as any)).toEqual({ score: 0, signals: {}, isRambling: false });
    expect(detectRambling("")).toEqual({ score: 0, signals: {}, isRambling: false });
  });

  it("applies a length bonus for very long utterances", () => {
    const long =
      "I was thinking about the project and how we need to finish it by next week and then we should probably review the code and also make sure the tests pass and then deploy it to staging and then maybe production and I think we need to coordinate with the team on this and also check with the stakeholders";
    expect(detectRambling(long).score).toBeGreaterThan(0);
  });

  it("caps the score at 1.0", () => {
    const extreme =
      "um uh like you know basically so actually I mean well I think probably maybe I guess sort of kind of right so basically like you know actually I mean well perhaps might could be I suppose I feel like";
    expect(detectRambling(extreme).score).toBeLessThanOrEqual(1);
  });
});

describe("RAMBLING_SIGNALS registry", () => {
  it("has the documented 6 signal categories", () => {
    expect(Object.keys(RAMBLING_SIGNALS)).toHaveLength(6);
  });

  it("every signal is a RegExp with the /g flag (so match returns all hits)", () => {
    for (const [, pattern] of Object.entries(RAMBLING_SIGNALS) as [string, RegExp][]) {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern.global).toBe(true);
    }
  });

  it("every category is detected independently in a multi-signal sentence", () => {
    const result = detectRambling(
      "I think probably maybe we should, you know basically like, no wait I mean, by the way speaking of, and then but also, the thing is what I'm saying is we need to change this",
    );
    const hitCategories = Object.entries(result.signals).filter(([, count]) => (count as number) > 0);
    expect(hitCategories.length).toBeGreaterThanOrEqual(3);
  });
});

describe("OUTPUT_MODES", () => {
  it("has the documented 5 output modes (auto + 4 specific)", () => {
    const ids = Object.keys(OUTPUT_MODES).sort();
    expect(ids).toEqual(["action", "auto", "decision", "question", "summary"]);
  });

  it("every mode has an id, name, description, and non-empty prompt", () => {
    for (const mode of Object.values(OUTPUT_MODES) as { id: string; name: string; description: string; prompt: string }[]) {
      expect(mode.id).toBeTruthy();
      expect(mode.name).toBeTruthy();
      expect(mode.description).toBeTruthy();
      expect(mode.prompt.length).toBeGreaterThan(30);
    }
  });
});

describe("getIntentPrompt", () => {
  it("returns the prompt for a known mode", () => {
    const actionPrompt = getIntentPrompt("action");
    expect(actionPrompt).toContain("action item");
  });

  it("falls back to the auto prompt for unknown modes", () => {
    expect(getIntentPrompt("made-up-mode")).toBe(OUTPUT_MODES.auto.prompt);
  });

  it("defaults to the auto prompt when no mode is passed", () => {
    expect(getIntentPrompt()).toBe(OUTPUT_MODES.auto.prompt);
  });
});

describe("getOutputModes", () => {
  it("returns { id, name, description } for every registered mode", () => {
    const list = getOutputModes() as { id: string; name: string; description: string }[];
    expect(list).toHaveLength(Object.keys(OUTPUT_MODES).length);
    for (const entry of list) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });
});
