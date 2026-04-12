/**
 * Tests for Recurring Capture — schedule validation, day/time parsing, fire logic.
 *
 * Imports `isValidTime`, `parseTime`, `getIsoDay`, `shouldFire`, and
 * `getPresets` directly from `bridge/recurring-capture-pure.js` — the same
 * pure module the runtime recurring-capture.js requires. No `app.getPath`
 * or fs involved, so no electron mock needed.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — CommonJS module, no TS declarations
import {
  isValidTime,
  parseTime,
  getIsoDay,
  shouldFire,
  getPresets,
} from "../../bridge/recurring-capture-pure";

interface Schedule {
  id: string;
  prompt: string;
  time: string;
  days: number[];
  enabled: boolean;
  lastFiredAt: string | null;
}

describe("isValidTime", () => {
  it("accepts valid 24h times", () => {
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("17:30")).toBe(true);
    expect(isValidTime("0:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
  });

  it("rejects invalid times", () => {
    expect(isValidTime("25:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
    expect(isValidTime("abc")).toBe(false);
    expect(isValidTime("")).toBe(false);
    expect(isValidTime(null)).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidTime("8")).toBe(false);
    expect(isValidTime("8:0")).toBe(false);
    expect(isValidTime("08:00:00")).toBe(false);
  });
});

describe("parseTime", () => {
  it("parses hours and minutes", () => {
    expect(parseTime("08:30")).toEqual({ hours: 8, minutes: 30 });
    expect(parseTime("17:00")).toEqual({ hours: 17, minutes: 0 });
    expect(parseTime("0:00")).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("getIsoDay", () => {
  it("converts JS day to ISO (Mon=1, Sun=7)", () => {
    // 2026-03-30 is a Monday
    expect(getIsoDay(new Date(2026, 2, 30))).toBe(1);
    // 2026-03-29 is a Sunday
    expect(getIsoDay(new Date(2026, 2, 29))).toBe(7);
    // 2026-03-31 is a Tuesday
    expect(getIsoDay(new Date(2026, 2, 31))).toBe(2);
  });
});

describe("shouldFire", () => {
  const baseSchedule: Schedule = {
    id: "test",
    prompt: "What did you accomplish?",
    time: "17:00",
    days: [1, 2, 3, 4, 5],
    enabled: true,
    lastFiredAt: null,
  };

  it("fires at the correct time and day", () => {
    const now = new Date(2026, 2, 30, 17, 0, 0);
    expect(shouldFire(baseSchedule, now)).toBe(true);
  });

  it("does not fire at wrong time", () => {
    const now = new Date(2026, 2, 30, 16, 59, 0);
    expect(shouldFire(baseSchedule, now)).toBe(false);
  });

  it("does not fire on wrong day", () => {
    // Sunday at 17:00 — day 7 is not in [1..5]
    const now = new Date(2026, 2, 29, 17, 0, 0);
    expect(shouldFire(baseSchedule, now)).toBe(false);
  });

  it("does not fire when disabled", () => {
    const disabled = { ...baseSchedule, enabled: false };
    const now = new Date(2026, 2, 30, 17, 0, 0);
    expect(shouldFire(disabled, now)).toBe(false);
  });

  it("does not fire twice in the same minute (lastFiredAt guard)", () => {
    const alreadyFired = {
      ...baseSchedule,
      lastFiredAt: new Date(2026, 2, 30, 17, 0, 30).toISOString(),
    };
    const now = new Date(2026, 2, 30, 17, 0, 45);
    expect(shouldFire(alreadyFired, now)).toBe(false);
  });

  it("fires again the next day at the same time", () => {
    const firedYesterday = {
      ...baseSchedule,
      lastFiredAt: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    };
    const tomorrow = new Date(2026, 2, 31, 17, 0, 0);
    expect(shouldFire(firedYesterday, tomorrow)).toBe(true);
  });

  it("honors weekend-only schedules", () => {
    const weekendOnly = { ...baseSchedule, days: [6, 7] };
    const sat = new Date(2026, 2, 28, 17, 0, 0);
    const mon = new Date(2026, 2, 30, 17, 0, 0);
    expect(shouldFire(weekendOnly, sat)).toBe(true);
    expect(shouldFire(weekendOnly, mon)).toBe(false);
  });
});

describe("getPresets", () => {
  const presets = getPresets() as { name: string; prompt: string; time: string; days: number[] }[];

  it("returns 4 preset configurations", () => {
    expect(presets).toHaveLength(4);
  });

  it("every preset has a valid HH:MM time", () => {
    for (const p of presets) {
      expect(isValidTime(p.time)).toBe(true);
    }
  });

  it("every preset has a non-empty day list and a prompt", () => {
    for (const p of presets) {
      expect(p.days.length).toBeGreaterThan(0);
      expect(p.prompt.length).toBeGreaterThan(0);
    }
  });

  it("weekly reflection is Friday-only", () => {
    const weekly = presets.find((p) => p.name === "Weekly Reflection");
    expect(weekly?.days).toEqual([5]);
  });
});
