/**
 * Tests for LatencyTracker — pipeline-stage timing collector.
 *
 * Uses the injectable fake clock from `latency-tracker.ts` so every
 * assertion is deterministic. No wall-clock race conditions, no
 * flakes.
 */

import { describe, it, expect } from "vitest";
import { LatencyTracker, fakeClock } from "./latency-tracker";
import { PERCEIVED_LATENCY_BUDGET_MS } from "./types";

function trackerWithSequence(sequence: number[], wallClock = 1_700_000_000_000): LatencyTracker {
  return new LatencyTracker(fakeClock(sequence, wallClock));
}

describe("LatencyTracker — basic lifecycle", () => {
  it("captures a wall-clock capturedAt once at construction", () => {
    const tracker = trackerWithSequence([], 1_712_000_000_000);
    expect(tracker.capturedAt).toBe(1_712_000_000_000);
  });

  it("records marks and returns raw stage times via get()", () => {
    const tracker = trackerWithSequence([100, 120]);
    tracker.mark("hotkey");
    tracker.mark("micOpen");
    expect(tracker.get("hotkey")).toBe(100);
    expect(tracker.get("micOpen")).toBe(120);
  });

  it("has() reports whether a stage was marked", () => {
    const tracker = trackerWithSequence([100]);
    tracker.mark("hotkey");
    expect(tracker.has("hotkey")).toBe(true);
    expect(tracker.has("micOpen")).toBe(false);
  });

  it("accepts an explicit `when` timestamp (e.g. captured earlier in an async chain)", () => {
    const tracker = trackerWithSequence([500]); // would be the default
    tracker.mark("micOpen", 200); // explicit — doesn't consume the sequence
    tracker.mark("micStop"); // this uses the sequence: 500
    expect(tracker.get("micOpen")).toBe(200);
    expect(tracker.get("micStop")).toBe(500);
  });
});

describe("LatencyTracker — duration math", () => {
  it("computes millisecond diffs between marked stages", () => {
    const tracker = trackerWithSequence([1000, 4500, 4650, 4830, 4845]);
    tracker.mark("hotkey");
    tracker.mark("micStop");
    tracker.mark("sttEnd");
    tracker.mark("polishEnd");
    tracker.mark("pasteEnd");

    expect(tracker.duration("hotkey", "micStop")).toBe(3500);
    expect(tracker.duration("micStop", "sttEnd")).toBe(150);
    expect(tracker.duration("sttEnd", "polishEnd")).toBe(180);
    expect(tracker.duration("polishEnd", "pasteEnd")).toBe(15);
  });

  it("rounds sub-millisecond diffs to the nearest whole ms", () => {
    const tracker = trackerWithSequence([100.1, 100.9]);
    tracker.mark("hotkey");
    tracker.mark("micOpen");
    expect(tracker.duration("hotkey", "micOpen")).toBe(1);
  });

  it("returns null when either stage is missing", () => {
    const tracker = trackerWithSequence([100]);
    tracker.mark("hotkey");
    expect(tracker.duration("hotkey", "pasteEnd")).toBeNull();
    expect(tracker.duration("sttStart", "sttEnd")).toBeNull();
  });

  it("coerces negative diffs to 0 (clock skew safety)", () => {
    const tracker = trackerWithSequence([500, 400]);
    tracker.mark("sttStart");
    tracker.mark("sttEnd"); // earlier than start — shouldn't happen, but defensively clamp
    expect(tracker.duration("sttStart", "sttEnd")).toBe(0);
  });
});

describe("LatencyTracker — toTimings() output", () => {
  it("produces a complete PipelineTimings record for a happy-path capture", () => {
    // Timeline (ms since some arbitrary t0):
    //   hotkey      = 0
    //   micOpen     = 10     (10ms arm)
    //   micStop     = 3010   (3s of speech)
    //   sttStart    = 3015   (5ms buffer flush)
    //   sttEnd      = 3195   (180ms STT)
    //   polishStart = 3200   (5ms handoff)
    //   polishEnd   = 3420   (220ms polish)
    //   pasteStart  = 3425   (5ms dispatch)
    //   pasteEnd    = 3440   (15ms paste)
    const tracker = trackerWithSequence(
      [0, 10, 3010, 3015, 3195, 3200, 3420, 3425, 3440],
      1_712_000_000_000,
    );
    tracker.mark("hotkey");
    tracker.mark("micOpen");
    tracker.mark("micStop");
    tracker.mark("sttStart");
    tracker.mark("sttEnd");
    tracker.mark("polishStart");
    tracker.mark("polishEnd");
    tracker.mark("pasteStart");
    tracker.mark("pasteEnd");

    const timings = tracker.toTimings();
    expect(timings).toEqual({
      capturedAt: 1_712_000_000_000,
      speakingMs: 3000,
      sttMs: 180,
      polishMs: 220,
      pasteMs: 15,
      perceivedMs: 430, // micStop (3010) → pasteEnd (3440)
      totalMs: 3440, // hotkey (0) → pasteEnd (3440)
    });
  });

  it("produces perceivedMs under the 500ms budget on a fast pipeline", () => {
    const tracker = trackerWithSequence([0, 10, 3010, 3015, 3180, 3185, 3380, 3385, 3400]);
    for (const stage of ["hotkey", "micOpen", "micStop", "sttStart", "sttEnd", "polishStart", "polishEnd", "pasteStart", "pasteEnd"] as const) {
      tracker.mark(stage);
    }
    const { perceivedMs } = tracker.toTimings();
    expect(perceivedMs).not.toBeNull();
    expect(perceivedMs).toBeLessThan(PERCEIVED_LATENCY_BUDGET_MS);
  });

  it("leaves polishMs null when the polish stage was skipped", () => {
    // No polishStart / polishEnd marks — polish was disabled for this capture
    const tracker = trackerWithSequence([0, 10, 3010, 3015, 3195, 3200, 3215]);
    tracker.mark("hotkey");
    tracker.mark("micOpen");
    tracker.mark("micStop");
    tracker.mark("sttStart");
    tracker.mark("sttEnd");
    tracker.mark("pasteStart");
    tracker.mark("pasteEnd");

    const timings = tracker.toTimings();
    expect(timings.polishMs).toBeNull();
    expect(timings.speakingMs).toBe(3000);
    expect(timings.sttMs).toBe(180);
    expect(timings.pasteMs).toBe(15);
    expect(timings.perceivedMs).toBe(205); // micStop (3010) → pasteEnd (3215)
  });

  it("leaves every duration null for a tracker with no marks", () => {
    const tracker = trackerWithSequence([]);
    const timings = tracker.toTimings();
    expect(timings.speakingMs).toBeNull();
    expect(timings.sttMs).toBeNull();
    expect(timings.polishMs).toBeNull();
    expect(timings.pasteMs).toBeNull();
    expect(timings.perceivedMs).toBeNull();
    expect(timings.totalMs).toBeNull();
    expect(timings.capturedAt).toBeGreaterThan(0);
  });

  it("handles a short-circuit snippet capture (no STT, no polish, just paste)", () => {
    // Voice snippet expansion path: transcript already exists, no STT or
    // polish happens, we jump straight from mic close to paste.
    const tracker = trackerWithSequence([0, 10, 2010, 2015, 2020]);
    tracker.mark("hotkey");
    tracker.mark("micOpen");
    tracker.mark("micStop");
    tracker.mark("pasteStart");
    tracker.mark("pasteEnd");

    const timings = tracker.toTimings();
    expect(timings.speakingMs).toBe(2000);
    expect(timings.sttMs).toBeNull();
    expect(timings.polishMs).toBeNull();
    expect(timings.pasteMs).toBe(5);
    expect(timings.perceivedMs).toBe(10);
    expect(timings.totalMs).toBe(2020);
  });
});

describe("fakeClock helper", () => {
  it("throws a clear error when the sequence is exhausted", () => {
    const tracker = trackerWithSequence([100]);
    tracker.mark("hotkey");
    expect(() => tracker.mark("micOpen")).toThrow(/fakeClock exhausted/);
  });
});
