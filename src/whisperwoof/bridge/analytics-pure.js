/**
 * Pure logic for the usage analytics dashboard.
 *
 * No database, no file I/O, no electron. Shared between analytics.js
 * (which runs the SQL queries) and analytics.test.ts.
 *
 * Production pattern: the SQL side fetches raw rows from bf_entries,
 * then delegates the number-crunching to the functions in this module.
 * That way tests exercise the same math production uses instead of a
 * parallel re-implementation.
 */

/**
 * Compute polish stats from a list of entries that have BOTH raw_text
 * and polished populated. `totalEntries` is the total row count across
 * bf_entries (including un-polished entries), used to compute the
 * polish rate.
 *
 * Returns { totalPolished, totalRaw, avgCharsSaved, polishRate }.
 * - `avgCharsSaved` is negative when polish shortens text (the common
 *   case — filler removal) and positive when it expands (e.g., the
 *   "expand" voice command).
 */
function computePolishStats(entries, totalEntries) {
  if (!entries || entries.length === 0) {
    return { totalPolished: 0, totalRaw: totalEntries || 0, avgCharsSaved: 0, polishRate: 0 };
  }

  let totalRawLen = 0;
  let totalPolishedLen = 0;

  for (const row of entries) {
    totalRawLen += (row.raw_text || "").length;
    totalPolishedLen += (row.polished || "").length;
  }

  const avgCharsDiff = Math.round((totalPolishedLen - totalRawLen) / entries.length);
  const polishRate = totalEntries > 0
    ? Math.round((entries.length / totalEntries) * 100)
    : 0;

  return {
    totalPolished: entries.length,
    totalRaw: totalEntries,
    avgCharsSaved: avgCharsDiff,
    polishRate,
  };
}

/**
 * Compute daily-usage streaks from a list of "days with at least one
 * entry" strings (YYYY-MM-DD), sorted descending (newest first).
 *
 * Returns { current, longest }:
 * - `current` counts from today backwards. If today has no entry, the
 *   current streak is 0 even if yesterday does.
 * - `longest` is the longest consecutive-day run anywhere in history.
 */
function computeStreaks(sortedDaysDesc) {
  if (!sortedDaysDesc || sortedDaysDesc.length === 0) {
    return { current: 0, longest: 0 };
  }

  const today = new Date().toISOString().split("T")[0];

  // Current streak — walk from today backwards, counting consecutive days
  let current = 0;
  let checkDate = today;
  for (const day of sortedDaysDesc) {
    if (day === checkDate) {
      current++;
      const d = new Date(checkDate);
      d.setDate(d.getDate() - 1);
      checkDate = d.toISOString().split("T")[0];
    } else if (day < checkDate) {
      break;
    }
  }

  // Longest streak — walk the full list looking for runs of consecutive
  // days (1-day gaps extend the run, any larger gap resets it).
  let longest = 0;
  let streak = 1;
  for (let i = 0; i < sortedDaysDesc.length - 1; i++) {
    const d1 = new Date(sortedDaysDesc[i]);
    const d2 = new Date(sortedDaysDesc[i + 1]);
    const diffDays = Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak++;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
  }
  longest = Math.max(longest, streak);

  return { current, longest };
}

/**
 * Fill missing hours in an hour-count list with zeros so the UI gets a
 * dense 24-element array [0..23] regardless of how sparse the data is.
 */
function fillHourGaps(hourCounts) {
  const hourMap = Object.fromEntries((hourCounts || []).map((r) => [r.hour, r.count]));
  const result = [];
  for (let h = 0; h < 24; h++) {
    result.push({ hour: h, count: hourMap[h] || 0 });
  }
  return result;
}

const VOICE_COMMAND_PREFIX = "voice-command:";
const SNIPPET_PREFIX = "snippet:";

/**
 * Extract a voice-command name from a `routed_to` field.
 * `"voice-command:rewrite"` → `"rewrite"`.
 */
function extractCommandName(routedTo) {
  if (!routedTo) return "";
  return routedTo.startsWith(VOICE_COMMAND_PREFIX)
    ? routedTo.slice(VOICE_COMMAND_PREFIX.length)
    : routedTo;
}

/**
 * Extract a snippet trigger phrase from a `routed_to` field.
 * `"snippet:my email"` → `"my email"`.
 */
function extractSnippetTrigger(routedTo) {
  if (!routedTo) return "";
  return routedTo.startsWith(SNIPPET_PREFIX)
    ? routedTo.slice(SNIPPET_PREFIX.length)
    : routedTo;
}

/**
 * Shape of a zero-data dashboard. Used as a fallback when the DB
 * isn't ready yet or an analytics query blows up.
 */
function getEmptyDashboard() {
  return {
    summary: { totalEntries: 0, todayEntries: 0, thisWeekEntries: 0, thisMonthEntries: 0 },
    entriesPerDay: [],
    sourceBreakdown: [],
    polishStats: { totalPolished: 0, totalRaw: 0, avgCharsSaved: 0, polishRate: 0 },
    topCommands: [],
    topSnippets: [],
    busiestHours: [],
    averageDuration: { avgMs: 0, totalMs: 0, count: 0 },
    streaks: { current: 0, longest: 0 },
  };
}

module.exports = {
  computePolishStats,
  computeStreaks,
  fillHourGaps,
  extractCommandName,
  extractSnippetTrigger,
  getEmptyDashboard,
  VOICE_COMMAND_PREFIX,
  SNIPPET_PREFIX,
};
