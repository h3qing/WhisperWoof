/**
 * Tests for Focus Mode pure logic — session lifecycle, presets, stats.
 *
 * Imports `SPRINT_PRESETS`, `validateDuration`, `createSessionObject`,
 * `appendEntryToSession`, `markSessionEnded`, `computeFocusStats`,
 * and `computeActiveSessionView` directly from `bridge/focus-mode-pure.js`.
 * That's the same module `focus-mode.js` delegates to for every
 * transformation — tests now exercise the real production math.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — CommonJS module, no TS declarations
import {
  SPRINT_PRESETS,
  MIN_DURATION,
  MAX_DURATION,
  COMPLETION_THRESHOLD,
  validateDuration,
  createSessionObject,
  appendEntryToSession,
  markSessionEnded,
  computeFocusStats,
  computeActiveSessionView,
} from "../../bridge/focus-mode-pure";

interface FocusSession {
  id: string;
  startedAt: string;
  durationMin: number;
  goal: string | null;
  presetId: string | null;
  entryIds: string[];
  wordCount: number;
  isActive: boolean;
  endedAt: string | null;
  actualDurationMin?: number;
  summary: string | null;
}

describe("SPRINT_PRESETS", () => {
  it("has 5 presets covering 5 to 60 minutes", () => {
    expect(SPRINT_PRESETS).toHaveLength(5);
    const durations = SPRINT_PRESETS.map((p: { durationMin: number }) => p.durationMin);
    expect(Math.min(...durations)).toBe(5);
    expect(Math.max(...durations)).toBe(60);
  });

  it("has unique preset IDs", () => {
    const ids = SPRINT_PRESETS.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes a pomodoro preset (25 min)", () => {
    const pomo = SPRINT_PRESETS.find((p: { id: string }) => p.id === "pomodoro");
    expect(pomo).toBeDefined();
    expect(pomo!.durationMin).toBe(25);
  });

  it("is frozen so runtime mutation can't corrupt the preset list", () => {
    expect(Object.isFrozen(SPRINT_PRESETS)).toBe(true);
  });
});

describe("validateDuration", () => {
  it("accepts durations inside the [MIN, MAX] range", () => {
    expect(validateDuration(MIN_DURATION)).toBeNull();
    expect(validateDuration(25)).toBeNull();
    expect(validateDuration(MAX_DURATION)).toBeNull();
  });

  it("rejects durations below the minimum", () => {
    expect(validateDuration(0)).toBeTruthy();
    expect(validateDuration(-5)).toBeTruthy();
  });

  it("rejects durations above the maximum", () => {
    expect(validateDuration(MAX_DURATION + 1)).toBeTruthy();
    expect(validateDuration(1000)).toBeTruthy();
  });

  it("rejects non-numbers", () => {
    expect(validateDuration("25" as unknown as number)).toBeTruthy();
    expect(validateDuration(NaN)).toBeTruthy();
    expect(validateDuration(Infinity)).toBeTruthy();
  });
});

describe("createSessionObject", () => {
  it("creates an active session with sane defaults", () => {
    const session = createSessionObject();
    expect(session.isActive).toBe(true);
    expect(session.durationMin).toBe(25);
    expect(session.entryIds).toHaveLength(0);
    expect(session.wordCount).toBe(0);
    expect(session.goal).toBeNull();
    expect(session.presetId).toBeNull();
    expect(session.endedAt).toBeNull();
    expect(session.summary).toBeNull();
  });

  it("honors custom duration, goal, and preset", () => {
    const session = createSessionObject({
      durationMin: 45,
      goal: "Brain dump project ideas",
      presetId: "deep",
    });
    expect(session.durationMin).toBe(45);
    expect(session.goal).toBe("Brain dump project ideas");
    expect(session.presetId).toBe("deep");
  });

  it("trims whitespace from the goal and null-terizes empty strings", () => {
    expect(createSessionObject({ goal: "  Write a blog post  " }).goal).toBe("Write a blog post");
    expect(createSessionObject({ goal: "" }).goal).toBeNull();
    expect(createSessionObject({ goal: "   " }).goal).toBeNull();
  });

  it("generates a unique-ish id when none is provided", () => {
    const a = createSessionObject();
    const b = createSessionObject();
    expect(a.id).toMatch(/^focus-/);
    expect(a.id).not.toBe(b.id);
  });
});

describe("appendEntryToSession", () => {
  it("adds entries immutably", () => {
    const s1 = createSessionObject();
    const s2 = appendEntryToSession(s1, "entry-1", 50);
    const s3 = appendEntryToSession(s2, "entry-2", 30);

    expect(s1.entryIds).toHaveLength(0);
    expect(s2.entryIds).toEqual(["entry-1"]);
    expect(s2.wordCount).toBe(50);
    expect(s3.entryIds).toEqual(["entry-1", "entry-2"]);
    expect(s3.wordCount).toBe(80);
  });

  it("does not mutate the input session", () => {
    const s1 = createSessionObject();
    appendEntryToSession(s1, "entry-1", 10);
    expect(s1.entryIds).toHaveLength(0);
    expect(s1.wordCount).toBe(0);
  });
});

describe("markSessionEnded", () => {
  it("populates endedAt, actualDurationMin, isActive=false, summary", () => {
    const started = new Date("2026-03-30T10:00:00Z");
    const session = { ...createSessionObject(), startedAt: started.toISOString() };
    const endedAt = new Date("2026-03-30T10:25:00Z");
    const ended = markSessionEnded(session, "Discussed 3 project ideas", endedAt.getTime());

    expect(ended.isActive).toBe(false);
    expect(ended.endedAt).toBe(endedAt.toISOString());
    expect(ended.summary).toBe("Discussed 3 project ideas");
    expect(ended.actualDurationMin).toBe(25);
  });

  it("handles a null summary cleanly", () => {
    const session = createSessionObject();
    const ended = markSessionEnded(session);
    expect(ended.summary).toBeNull();
    expect(ended.isActive).toBe(false);
  });
});

describe("computeFocusStats", () => {
  const sampleSessions: FocusSession[] = [
    { ...createSessionObject({ durationMin: 25 }), entryIds: ["e1", "e2", "e3"], wordCount: 150, actualDurationMin: 25, isActive: false, endedAt: "2026-03-30T10:00:00Z" },
    { ...createSessionObject({ durationMin: 25 }), entryIds: ["e4", "e5"], wordCount: 80, actualDurationMin: 20, isActive: false, endedAt: "2026-03-30T11:00:00Z" },
    { ...createSessionObject({ durationMin: 45 }), entryIds: ["e6"], wordCount: 200, actualDurationMin: 45, isActive: false, endedAt: "2026-03-30T12:00:00Z" },
  ];

  it("computes totals across sessions", () => {
    const stats = computeFocusStats(sampleSessions);
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalMinutes).toBe(90);
    expect(stats.totalWords).toBe(430);
    expect(stats.totalEntries).toBe(6);
    expect(stats.avgDuration).toBe(30);
  });

  it("treats 80% of target duration as completed", () => {
    // Session 2 hit 20/25 = exactly 80% → counts. All three qualify.
    expect(computeFocusStats(sampleSessions).completionRate).toBe(100);
  });

  it("computation threshold is 0.8 (exported constant matches behavior)", () => {
    expect(COMPLETION_THRESHOLD).toBe(0.8);
  });

  it("flags short sessions as incomplete", () => {
    const short: FocusSession[] = [
      { ...createSessionObject({ durationMin: 25 }), entryIds: [], wordCount: 0, actualDurationMin: 5, isActive: false, endedAt: "2026-03-30T10:00:00Z" },
    ];
    expect(computeFocusStats(short).completionRate).toBe(0);
  });

  it("returns zeros for an empty or null list", () => {
    const zero = computeFocusStats([]);
    expect(zero.totalSessions).toBe(0);
    expect(zero.totalMinutes).toBe(0);
    expect(zero.completionRate).toBe(0);
    expect(zero.currentStreak).toBe(0);
    expect(computeFocusStats(null).totalSessions).toBe(0);
  });

  it("counts today-backwards streaks by calendar day", () => {
    const today = new Date().toISOString().split("T")[0];
    const d1 = new Date();
    d1.setDate(d1.getDate() - 1);
    const yesterday = d1.toISOString().split("T")[0];

    const sessions: FocusSession[] = [
      { ...createSessionObject(), startedAt: `${today}T10:00:00.000Z`, actualDurationMin: 25, isActive: false, endedAt: null },
      { ...createSessionObject(), startedAt: `${yesterday}T10:00:00.000Z`, actualDurationMin: 25, isActive: false, endedAt: null },
    ];
    expect(computeFocusStats(sessions).currentStreak).toBe(2);
  });
});

describe("computeActiveSessionView", () => {
  it("returns null for a null session", () => {
    expect(computeActiveSessionView(null)).toBeNull();
  });

  it("derives elapsedMin, remainingMin, isExpired from a fixed `now`", () => {
    const startedAt = new Date("2026-03-30T10:00:00Z");
    const session = { ...createSessionObject({ durationMin: 25 }), startedAt: startedAt.toISOString() };
    // 10 minutes later
    const now = new Date("2026-03-30T10:10:00Z").getTime();
    const view = computeActiveSessionView(session, now);
    expect(view.elapsedMin).toBe(10);
    expect(view.remainingMin).toBe(15);
    expect(view.isExpired).toBe(false);
  });

  it("marks the session expired once elapsed ≥ duration", () => {
    const startedAt = new Date("2026-03-30T10:00:00Z");
    const session = { ...createSessionObject({ durationMin: 25 }), startedAt: startedAt.toISOString() };
    const now = new Date("2026-03-30T10:30:00Z").getTime();
    const view = computeActiveSessionView(session, now);
    expect(view.remainingMin).toBe(0);
    expect(view.isExpired).toBe(true);
  });
});
