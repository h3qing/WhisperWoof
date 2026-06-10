/**
 * Usage Analytics — Dashboard data from bf_entries
 *
 * Queries the SQLite database for usage patterns, trends, and insights.
 * All computation is done in SQL for performance (handles 10K+ entries).
 *
 * Returns pre-computed dashboard data — no raw entries exposed.
 */

const debugLogger = require("../../helpers/debugLogger");
const {
  computePolishStats,
  computeStreaks,
  fillHourGaps,
  extractCommandName,
  getEmptyDashboard,
  VOICE_COMMAND_PREFIX,
} = require("./analytics-pure");

let db = null;

/**
 * Set the database reference (called from app-init).
 */
function setDatabase(database) {
  db = database;
}

/**
 * Get the full analytics dashboard payload.
 * Single call returns all metrics — avoids multiple IPC round-trips.
 */
function getDashboard(options = {}) {
  if (!db) return getEmptyDashboard();

  const days = options.days || 30;

  try {
    return {
      summary: getSummary(),
      entriesPerDay: getEntriesPerDay(days),
      sourceBreakdown: getSourceBreakdown(),
      polishStats: getPolishStats(),
      topCommands: getTopCommands(10),
      busiestHours: getBusiestHours(),
      averageDuration: getAverageDuration(),
      streaks: getStreaks(),
    };
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Analytics query failed", { error: err.message });
    return getEmptyDashboard();
  }
}

// getEmptyDashboard lives in ./analytics-pure and is required at the top.

// --- Individual metrics ---

function getSummary() {
  const total = db.prepare("SELECT COUNT(*) as count FROM bf_entries").get();
  const today = db.prepare(
    "SELECT COUNT(*) as count FROM bf_entries WHERE date(created_at) = date('now')"
  ).get();
  const week = db.prepare(
    "SELECT COUNT(*) as count FROM bf_entries WHERE created_at >= datetime('now', '-7 days')"
  ).get();
  const month = db.prepare(
    "SELECT COUNT(*) as count FROM bf_entries WHERE created_at >= datetime('now', '-30 days')"
  ).get();

  return {
    totalEntries: total.count,
    todayEntries: today.count,
    thisWeekEntries: week.count,
    thisMonthEntries: month.count,
  };
}

function getEntriesPerDay(days) {
  const rows = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM bf_entries
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  return rows.map((r) => ({ day: r.day, count: r.count }));
}

function getSourceBreakdown() {
  const rows = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM bf_entries
    GROUP BY source
    ORDER BY count DESC
  `).all();

  return rows.map((r) => ({ source: r.source, count: r.count }));
}

function getPolishStats() {
  const rows = db.prepare(`
    SELECT raw_text, polished
    FROM bf_entries
    WHERE polished IS NOT NULL AND raw_text IS NOT NULL
  `).all();
  const totalEntries = db.prepare("SELECT COUNT(*) as count FROM bf_entries").get().count;
  return computePolishStats(rows, totalEntries);
}

function getTopCommands(limit) {
  // Voice commands are stored in routed_to as "voice-command:rewrite" etc.
  const rows = db.prepare(`
    SELECT routed_to, COUNT(*) as count
    FROM bf_entries
    WHERE routed_to LIKE '${VOICE_COMMAND_PREFIX}%'
    GROUP BY routed_to
    ORDER BY count DESC
    LIMIT ?
  `).all(limit);

  return rows.map((r) => ({
    command: extractCommandName(r.routed_to),
    count: r.count,
  }));
}

function getBusiestHours() {
  const rows = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
    FROM bf_entries
    GROUP BY hour
    ORDER BY hour ASC
  `).all();
  return fillHourGaps(rows);
}

function getAverageDuration() {
  const row = db.prepare(`
    SELECT AVG(duration_ms) as avg_ms, SUM(duration_ms) as total_ms, COUNT(*) as count
    FROM bf_entries
    WHERE duration_ms IS NOT NULL AND duration_ms > 0
  `).get();

  return {
    avgMs: Math.round(row.avg_ms || 0),
    totalMs: row.total_ms || 0,
    count: row.count || 0,
  };
}

function getStreaks() {
  const rows = db.prepare(`
    SELECT DISTINCT date(created_at) as day
    FROM bf_entries
    ORDER BY day DESC
  `).all();
  return computeStreaks(rows.map((r) => r.day));
}

module.exports = {
  setDatabase,
  getDashboard,
  getSummary,
  getEntriesPerDay,
  getSourceBreakdown,
  getPolishStats,
  getTopCommands,
  getBusiestHours,
  getAverageDuration,
  getStreaks,
};
