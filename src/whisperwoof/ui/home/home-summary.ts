/**
 * The Home page opens with one sentence stating what happened, then a row of
 * facts (not a dashboard of tiles). Counts cover every saved entry (voice,
 * clipboard, meetings, imports), over the last 7 days rather than a
 * calendar week, so the words say exactly that.
 */

export interface HomeSummaryInput {
  summary: { totalEntries: number; todayEntries: number; thisWeekEntries: number };
  streaks: { current: number };
  polishStats: { polishRate: number; totalPolished: number };
  averageDuration: { avgMs: number; totalMs: number };
}

export interface HomeHeadline {
  /** Rendered in the accent before `rest`; null when there is nothing to count. */
  count: number | null;
  rest: string;
}

export interface HomeFact {
  label: string;
  value: string;
}

export function homeHeadline({ summary }: HomeSummaryInput): HomeHeadline {
  const week = summary.thisWeekEntries;
  const today = summary.todayEntries;
  if (week === 0) return { count: null, rest: "Nothing new in the last 7 days." };
  if (week === 1) {
    return { count: 1, rest: today > 0 ? "entry in the last 7 days, and it was today." : "entry in the last 7 days." };
  }
  const share = today === 0 ? "none" : today >= week ? "all" : String(today);
  return { count: week, rest: `entries in the last 7 days, ${share} of them today.` };
}

// Round to whole seconds first, then pick the unit, so 59.6 s reads "1 min".
function voiceTime(totalMs: number): string {
  const seconds = Math.round(totalMs / 1000);
  if (seconds < 1) return "under 1 s";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60).toLocaleString("en-US")} h`;
}

export function homeFacts({ summary, streaks, polishStats, averageDuration }: HomeSummaryInput): HomeFact[] {
  const facts: HomeFact[] = [];
  if (streaks.current > 0) {
    facts.push({ label: "Streak", value: `${streaks.current} ${streaks.current === 1 ? "day" : "days"}` });
  }
  if (averageDuration.avgMs > 0) {
    facts.push({ label: "Average recording", value: `${(averageDuration.avgMs / 1000).toFixed(1)} s` });
  }
  if (averageDuration.totalMs > 0) {
    facts.push({ label: "Voice recorded", value: voiceTime(averageDuration.totalMs) });
  }
  if (polishStats.totalPolished > 0) {
    facts.push({ label: "Cleaned up", value: `${Math.round(polishStats.polishRate)}%` });
  }
  facts.push({ label: "All time", value: summary.totalEntries.toLocaleString("en-US") });
  return facts;
}
