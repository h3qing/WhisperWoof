/**
 * Pure logic for Focus Mode — sprint sessions.
 *
 * No file I/O, no electron, no side effects. Shared between
 * focus-mode.js (which owns the module-level `activeSession` and
 * persists history to disk) and focus-mode.test.ts.
 *
 * The pattern: production's `startSession` / `recordEntry` /
 * `endSession` handle state and I/O, but every transformation of a
 * session object goes through these pure functions so tests can
 * exercise the real production math.
 */

/**
 * Preset sprint durations shown in the quick-setup UI.
 */
const SPRINT_PRESETS = Object.freeze([
  { id: "quick", name: "Quick Capture", durationMin: 5, description: "5 min — rapid brain dump" },
  { id: "short", name: "Short Sprint", durationMin: 15, description: "15 min — focused note-taking" },
  { id: "pomodoro", name: "Pomodoro", durationMin: 25, description: "25 min — classic focus session" },
  { id: "deep", name: "Deep Work", durationMin: 45, description: "45 min — extended thinking" },
  { id: "marathon", name: "Marathon", durationMin: 60, description: "60 min — long creative session" },
]);

const MIN_DURATION = 1;
const MAX_DURATION = 180;
const COMPLETION_THRESHOLD = 0.8; // 80% of target duration counts as "completed"

/**
 * Validate a requested sprint duration in minutes.
 * Returns null if valid, or a human-readable error string.
 */
function validateDuration(durationMin) {
  if (typeof durationMin !== "number" || !Number.isFinite(durationMin)) {
    return `Duration must be a number between ${MIN_DURATION} and ${MAX_DURATION} minutes`;
  }
  if (durationMin < MIN_DURATION || durationMin > MAX_DURATION) {
    return `Duration must be ${MIN_DURATION}-${MAX_DURATION} minutes`;
  }
  return null;
}

/**
 * Build a new session object. Side-effect-free — production calls this
 * and assigns the result to the module-level `activeSession`.
 */
function createSessionObject(options = {}) {
  const durationMin = options.durationMin || 25;
  return {
    id: options.id || `focus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: options.startedAt || new Date().toISOString(),
    durationMin,
    goal: (options.goal || "").trim() || null,
    presetId: options.presetId || null,
    entryIds: [],
    wordCount: 0,
    isActive: true,
    endedAt: null,
    summary: null,
  };
}

/**
 * Return a new session with the entry appended and word count updated.
 * Immutable — does not mutate `session`.
 */
function appendEntryToSession(session, entryId, wordCount = 0) {
  return {
    ...session,
    entryIds: [...session.entryIds, entryId],
    wordCount: session.wordCount + wordCount,
  };
}

/**
 * Return a new session marked ended, with `endedAt` / `summary` /
 * `actualDurationMin` populated. `now` defaults to Date.now() but can
 * be passed for deterministic tests.
 */
function markSessionEnded(session, summary = null, now = Date.now()) {
  return {
    ...session,
    isActive: false,
    endedAt: new Date(now).toISOString(),
    summary: summary || null,
    actualDurationMin: Math.round((now - new Date(session.startedAt).getTime()) / 60000),
  };
}

/**
 * Compute dashboard stats from a list of completed sessions.
 * Returns totals, averages, completion rate, and a current-day streak.
 */
function computeFocusStats(sessions) {
  if (!sessions || sessions.length === 0) {
    return {
      totalSessions: 0,
      totalMinutes: 0,
      totalWords: 0,
      totalEntries: 0,
      avgDuration: 0,
      completionRate: 0,
      currentStreak: 0,
    };
  }

  const totalMin = sessions.reduce((sum, s) => sum + (s.actualDurationMin || 0), 0);
  const totalWords = sessions.reduce((sum, s) => sum + (s.wordCount || 0), 0);
  const totalEntries = sessions.reduce((sum, s) => sum + (s.entryIds?.length || 0), 0);

  const completed = sessions.filter(
    (s) => (s.actualDurationMin || 0) >= s.durationMin * COMPLETION_THRESHOLD,
  ).length;

  // Current-day streak: count consecutive calendar days backwards from
  // today that had at least one session.
  const sessionDays = new Set(sessions.map((s) => s.startedAt.split("T")[0]));
  const sortedDays = Array.from(sessionDays).sort().reverse();
  const today = new Date().toISOString().split("T")[0];

  let streak = 0;
  let checkDate = today;
  for (const day of sortedDays) {
    if (day === checkDate) {
      streak++;
      const d = new Date(checkDate);
      d.setDate(d.getDate() - 1);
      checkDate = d.toISOString().split("T")[0];
    } else if (day < checkDate) {
      break;
    }
  }

  return {
    totalSessions: sessions.length,
    totalMinutes: totalMin,
    totalWords,
    totalEntries,
    avgDuration: Math.round(totalMin / sessions.length),
    completionRate: Math.round((completed / sessions.length) * 100),
    currentStreak: streak,
  };
}

/**
 * Compute derived display fields for an active session (elapsed /
 * remaining / expired). Pure — takes `now` for deterministic tests.
 */
function computeActiveSessionView(session, now = Date.now()) {
  if (!session) return null;
  const elapsedMin = (now - new Date(session.startedAt).getTime()) / 60000;
  const remaining = Math.max(0, session.durationMin - elapsedMin);
  return {
    ...session,
    elapsedMin: Math.round(elapsedMin * 10) / 10,
    remainingMin: Math.round(remaining * 10) / 10,
    isExpired: remaining <= 0,
  };
}

module.exports = {
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
};
