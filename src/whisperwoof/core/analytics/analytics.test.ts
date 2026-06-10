/**
 * Tests for Usage Analytics — polish stats, streaks, hour filling, prefix
 * extraction, and the empty-dashboard fallback.
 *
 * Imports the real pure helpers from `bridge/analytics-pure.js`, which
 * is the exact module `analytics.js` delegates to after running its SQL
 * queries. Previously these helpers only existed inline inside
 * `getPolishStats` / `getStreaks` / `getBusiestHours` etc., and the
 * test file had parallel copies that silently drifted.
 */

import { describe, it, expect } from "vitest";
import {
  computePolishStats,
  computeStreaks,
  fillHourGaps,
  extractCommandName,
  getEmptyDashboard,
  VOICE_COMMAND_PREFIX,
} from "../../bridge/analytics-pure";

describe("computePolishStats", () => {
  it("returns negative avgCharsSaved when polish shortens text", () => {
    const entries = [
      { raw_text: "um so like I need to buy groceries", polished: "I need to buy groceries" },
      { raw_text: "uh basically we should you know go there", polished: "We should go there" },
    ];
    const stats = computePolishStats(entries, 10);
    expect(stats.totalPolished).toBe(2);
    expect(stats.avgCharsSaved).toBeLessThan(0);
    expect(stats.polishRate).toBe(20); // 2 / 10
  });

  it("returns positive avgCharsSaved when polish expands text", () => {
    const entries = [{ raw_text: "buy milk", polished: "I need to buy milk from the grocery store." }];
    const stats = computePolishStats(entries, 1);
    expect(stats.avgCharsSaved).toBeGreaterThan(0);
  });

  it("zeros out cleanly when there are no polished entries", () => {
    const stats = computePolishStats([], 5);
    expect(stats.totalPolished).toBe(0);
    expect(stats.avgCharsSaved).toBe(0);
    expect(stats.polishRate).toBe(0);
    expect(stats.totalRaw).toBe(5);
  });

  it("computes polish rate as a rounded percentage of total entries", () => {
    const entries = [
      { raw_text: "a", polished: "A." },
      { raw_text: "b", polished: "B." },
      { raw_text: "c", polished: "C." },
    ];
    const stats = computePolishStats(entries, 4);
    expect(stats.polishRate).toBe(75); // 3 / 4
  });

  it("handles null raw_text and polished fields without crashing", () => {
    const stats = computePolishStats(
      [{ raw_text: null, polished: "hi" }, { raw_text: "bye", polished: null }],
      2,
    );
    expect(stats.totalPolished).toBe(2);
  });

  it("accepts a null entries argument and returns zeros", () => {
    expect(computePolishStats(null, 10).totalPolished).toBe(0);
  });
});

describe("computeStreaks", () => {
  it("counts a 5-day streak ending today", () => {
    const today = new Date();
    const days: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split("T")[0]!);
    }
    const { current } = computeStreaks(days);
    expect(current).toBe(5);
  });

  it("current streak is 0 if today has no entry", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const { current } = computeStreaks([twoDaysAgo.toISOString().split("T")[0]]);
    expect(current).toBe(0);
  });

  it("finds the longest run across gaps", () => {
    const days = [
      "2026-03-30", "2026-03-29", "2026-03-28", // 3-day run
      // gap at 2026-03-27
      "2026-03-25", "2026-03-24", "2026-03-23", "2026-03-22", "2026-03-21", // 5-day run
    ];
    const { longest } = computeStreaks(days);
    expect(longest).toBe(5);
  });

  it("treats a single day as a 1-day streak", () => {
    const today = new Date().toISOString().split("T")[0];
    const { current, longest } = computeStreaks([today]);
    expect(current).toBe(1);
    expect(longest).toBe(1);
  });

  it("returns zeros for an empty or null list", () => {
    expect(computeStreaks([])).toEqual({ current: 0, longest: 0 });
    expect(computeStreaks(null)).toEqual({ current: 0, longest: 0 });
  });
});

describe("fillHourGaps", () => {
  it("fills missing hours with 0 and preserves present counts", () => {
    const sparse = [{ hour: 9, count: 5 }, { hour: 14, count: 3 }];
    const filled = fillHourGaps(sparse);
    expect(filled).toHaveLength(24);
    expect(filled[0]!.count).toBe(0);
    expect(filled[9]!.count).toBe(5);
    expect(filled[14]!.count).toBe(3);
    expect(filled[23]!.count).toBe(0);
  });

  it("returns a full 24-element zero array for empty input", () => {
    const filled = fillHourGaps([]);
    expect(filled).toHaveLength(24);
    expect(filled.every((h: { count: number }) => h.count === 0)).toBe(true);
  });

  it("orders hours 0..23 in the result regardless of input order", () => {
    const filled = fillHourGaps([{ hour: 14, count: 1 }, { hour: 2, count: 1 }]);
    for (let i = 0; i < 24; i++) {
      expect(filled[i]!.hour).toBe(i);
    }
  });
});

describe("routed_to prefix extraction", () => {
  it("extracts the command name after the voice-command prefix", () => {
    expect(extractCommandName(`${VOICE_COMMAND_PREFIX}rewrite`)).toBe("rewrite");
    expect(extractCommandName(`${VOICE_COMMAND_PREFIX}translate`)).toBe("translate");
    expect(extractCommandName(`${VOICE_COMMAND_PREFIX}summarize`)).toBe("summarize");
  });

  it("leaves strings without the expected prefix unchanged", () => {
    expect(extractCommandName("paste-at-cursor")).toBe("paste-at-cursor");
  });

  it("returns empty string for null / undefined input", () => {
    expect(extractCommandName(null)).toBe("");
  });
});

describe("getEmptyDashboard", () => {
  it("returns a zero-filled dashboard shape the UI can render directly", () => {
    const empty = getEmptyDashboard();
    expect(empty.summary.totalEntries).toBe(0);
    expect(empty.entriesPerDay).toEqual([]);
    expect(empty.sourceBreakdown).toEqual([]);
    expect(empty.polishStats.polishRate).toBe(0);
    expect(empty.topCommands).toEqual([]);
    expect(empty.busiestHours).toEqual([]);
    expect(empty.averageDuration.avgMs).toBe(0);
    expect(empty.streaks).toEqual({ current: 0, longest: 0 });
  });
});
