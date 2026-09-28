/**
 * The Meetings tab's list decisions (ui/meetings/meetings-list.ts): notes
 * under a divider per day, newest first, and the calendar events still to
 * come today.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { groupByDay, comingUpToday } from "./meetings-list";
import type { CalendarEvent } from "../../../types/calendar";

// SQLite dates are UTC without a zone ("YYYY-MM-DD HH:MM:SS"); days are local.
const db = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
const at = (day: number, h: number, m = 0) => db(new Date(2026, 8, day, h, m));
const note = (id: number, created_at: string) => ({ id, created_at });
const dayLabel = (d: Date) => `Sep ${d.getDate()}`;

describe("groupByDay", () => {
  it("puts notes under one divider per day, newest day and newest note first", () => {
    const groups = groupByDay(
      [note(1, at(26, 9)), note(2, at(28, 8)), note(3, at(28, 10, 30)), note(4, at(26, 23, 30))],
      dayLabel
    );
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Sep 28", [3, 2]],
      ["Sep 26", [4, 1]],
    ]);
  });

  it("returns nothing for no notes", () => {
    expect(groupByDay([], dayLabel)).toEqual([]);
  });

  it("keeps a note whose date can't be read, under its own divider at the end", () => {
    const groups = groupByDay([note(1, "not a date"), note(2, at(28, 8))], () => "day");
    expect(groups.map((g) => g.notes.map((n) => n.id))).toEqual([[2], [1]]);
  });
});

describe("groupByDay, west of UTC", () => {
  // CI runs in UTC, where a UTC-day bug can't show; Los Angeles makes it show.
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("groups by the local day, not the UTC day", () => {
    // 2026-09-27 05:30Z is Sep 26, 22:30 in Los Angeles.
    const groups = groupByDay(
      [note(1, "2026-09-27 05:30:00"), note(2, "2026-09-26 20:00:00")],
      (d) => `Sep ${d.getDate()}`
    );
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([["Sep 26", [1, 2]]]);
  });

  it("puts every note with an unreadable date in one group at the end", () => {
    const groups = groupByDay(
      [note(1, "nope"), note(2, "2026-09-26 20:00:00"), note(3, "also nope")],
      () => "day"
    );
    expect(groups.map((g) => g.notes.map((n) => n.id).sort())).toEqual([[2], [1, 3]]);
  });
});

const event = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}) =>
  ({
    id,
    calendar_id: "c",
    summary: id,
    start_time: start,
    end_time: end,
    is_all_day: 0,
    status: "confirmed",
    hangout_link: null,
    conference_data: null,
    organizer_email: null,
    attendees_count: 3,
    ...extra,
  }) as CalendarEvent;

/** The same instant written as Google does with a +hh:00 offset, e.g. 2026-09-28T23:00:00+09:00. */
function toOffsetString(d: Date, hours: number) {
  const shifted = new Date(d.getTime() + hours * 3600_000);
  return `${shifted.toISOString().slice(0, 19)}+${String(hours).padStart(2, "0")}:00`;
}

describe("comingUpToday", () => {
  const now = new Date(2026, 8, 28, 11, 0); // Sep 28, 11:00 local

  it("lists today's events that haven't ended, in start order", () => {
    const later = event(
      "later",
      new Date(2026, 8, 28, 15, 0).toISOString(),
      new Date(2026, 8, 28, 16, 0).toISOString()
    );
    const running = event(
      "running",
      new Date(2026, 8, 28, 10, 30).toISOString(),
      new Date(2026, 8, 28, 11, 30).toISOString()
    );
    const done = event(
      "done",
      new Date(2026, 8, 28, 9, 0).toISOString(),
      new Date(2026, 8, 28, 10, 0).toISOString()
    );
    expect(comingUpToday([later, done, running], now).map((e) => e.id)).toEqual([
      "running",
      "later",
    ]);
  });

  it("drops an event the moment it ends, and reads start times given with an offset", () => {
    const endsNow = event(
      "ends-now",
      new Date(2026, 8, 28, 10, 0).toISOString(),
      now.toISOString()
    );
    const utcPlus9 = new Date(2026, 8, 28, 14, 0);
    const offset = event(
      "offset",
      toOffsetString(utcPlus9, 9),
      toOffsetString(new Date(2026, 8, 28, 15, 0), 9)
    );
    expect(comingUpToday([endsNow, offset], now).map((e) => e.id)).toEqual(["offset"]);
  });

  it("leaves out tomorrow, all-day and cancelled events", () => {
    const tomorrow = event(
      "tomorrow",
      new Date(2026, 8, 29, 9, 0).toISOString(),
      new Date(2026, 8, 29, 10, 0).toISOString()
    );
    const allDay = event(
      "all-day",
      new Date(2026, 8, 28, 0, 0).toISOString(),
      new Date(2026, 8, 29, 0, 0).toISOString(),
      { is_all_day: 1 }
    );
    const cancelled = event(
      "cancelled",
      new Date(2026, 8, 28, 14, 0).toISOString(),
      new Date(2026, 8, 28, 15, 0).toISOString(),
      { status: "cancelled" }
    );
    expect(comingUpToday([tomorrow, allDay, cancelled], now)).toEqual([]);
  });
});
