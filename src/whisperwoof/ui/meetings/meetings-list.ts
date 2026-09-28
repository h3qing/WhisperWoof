/**
 * The Meetings tab's list: notes under a divider per day (the day they were
 * made, so a meeting stays on the day it happened), and the calendar events
 * today that haven't ended (the one under way too), each of which can be recorded.
 */
import { normalizeDbDate } from "../../../utils/dateFormatting";
import type { CalendarEvent } from "../../../types/calendar";

export interface DayGroup<T> {
  label: string;
  notes: T[];
}

const localDayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Newest day first, newest note first within it; unreadable dates go last. */
export function groupByDay<T extends { created_at: string }>(
  notes: T[],
  labelFor: (day: Date) => string
): DayGroup<T>[] {
  const dated = notes
    .map((note) => ({ note, at: normalizeDbDate(note.created_at) }))
    .sort((a, b) => (b.at.getTime() || -Infinity) - (a.at.getTime() || -Infinity));

  const groups: Array<DayGroup<T> & { key: string }> = [];
  for (const { note, at } of dated) {
    const valid = !Number.isNaN(at.getTime());
    const key = valid ? localDayKey(at) : "unknown";
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      groups[groups.length - 1] = { ...last, notes: [...last.notes, note] };
    } else {
      groups.push({ key, label: valid ? labelFor(at) : "", notes: [note] });
    }
  }
  return groups.map(({ label, notes: items }) => ({ label, notes: items }));
}

/** Today's timed events that haven't ended yet, in start order. */
export function comingUpToday(events: CalendarEvent[], now: Date): CalendarEvent[] {
  const today = localDayKey(now);
  return events
    .filter((e) => !e.is_all_day && e.status !== "cancelled")
    .filter((e) => localDayKey(new Date(e.start_time)) === today)
    .filter((e) => new Date(e.end_time).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}
