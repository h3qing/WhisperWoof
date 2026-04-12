/**
 * Focus Mode — Voice-powered productivity sprints
 *
 * Timed focus sessions where the user captures thoughts via voice.
 * After the session ends, WhisperWoof summarizes everything captured.
 *
 * Unique to WhisperWoof — no competitor (Wispr Flow, SuperWhisper,
 * Aqua Voice, DictaFlow) has a built-in focus mode.
 *
 * Features:
 * - Configurable sprint duration (5/15/25/45/60 min)
 * - Auto-tags all entries during the session
 * - Session summary via LLM at the end
 * - Do Not Disturb integration (suppress notifications)
 * - Entry count + word count tracking
 * - Session history for streak tracking
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-focus-sessions.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  SPRINT_PRESETS,
  validateDuration,
  createSessionObject,
  appendEntryToSession,
  markSessionEnded,
  computeFocusStats,
  computeActiveSessionView,
} = require("./focus-mode-pure");

const SESSIONS_FILE = path.join(app.getPath("userData"), "whisperwoof-focus-sessions.json");
const MAX_SESSIONS = 500;

// --- Active session (in-memory, one at a time) ---

let activeSession = null;

/**
 * Start a new focus session.
 *
 * @param {object} options
 * @param {number} options.durationMin - Sprint length in minutes
 * @param {string} options.goal - What the user wants to accomplish (optional)
 * @param {string} options.presetId - One of the SPRINT_PRESETS ids (optional)
 * @returns {{ success: boolean, session?: object, error?: string }}
 */
function startSession(options = {}) {
  if (activeSession) {
    return { success: false, error: "A focus session is already active" };
  }

  const durationMin = options.durationMin || 25;
  const validationError = validateDuration(durationMin);
  if (validationError) return { success: false, error: validationError };

  activeSession = createSessionObject({ ...options, durationMin });

  debugLogger.info("[WhisperWoof] Focus session started", {
    id: activeSession.id,
    durationMin,
    goal: activeSession.goal,
  });

  return { success: true, session: { ...activeSession } };
}

/**
 * Record an entry captured during the active focus session.
 */
function recordEntry(entryId, wordCount = 0) {
  if (!activeSession || !activeSession.isActive) return false;
  activeSession = appendEntryToSession(activeSession, entryId, wordCount);
  return true;
}

/**
 * End the active focus session.
 *
 * @param {string|null} summary - LLM-generated summary of the session (optional)
 * @returns {{ success: boolean, session?: object }}
 */
function endSession(summary = null) {
  if (!activeSession) {
    return { success: false, error: "No active focus session" };
  }

  const completed = markSessionEnded(activeSession, summary);

  // Save to history
  const sessions = loadSessions();
  sessions.push(completed);
  const pruned = sessions.length > MAX_SESSIONS
    ? sessions.slice(sessions.length - MAX_SESSIONS)
    : sessions;
  saveSessions(pruned);

  activeSession = null;

  debugLogger.info("[WhisperWoof] Focus session ended", {
    id: completed.id,
    entries: completed.entryIds.length,
    wordCount: completed.wordCount,
    actualMin: completed.actualDurationMin,
  });

  return { success: true, session: completed };
}

/**
 * Get the current active session (or null).
 */
function getActiveSession() {
  return computeActiveSessionView(activeSession);
}

/**
 * Check if a focus session is currently active.
 */
function isSessionActive() {
  return activeSession !== null && activeSession.isActive;
}

// --- Session history ---

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load focus sessions", { error: err.message });
  }
  return [];
}

function saveSessions(sessions) {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save focus sessions", { error: err.message });
  }
}

/**
 * Get session history with optional filters.
 */
function getSessionHistory(options = {}) {
  let sessions = loadSessions();

  if (options.days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.days);
    sessions = sessions.filter((s) => new Date(s.startedAt) >= cutoff);
  }

  if (options.limit) {
    sessions = sessions.slice(-options.limit);
  }

  return sessions;
}

/**
 * Get focus stats (for analytics dashboard).
 */
function getFocusStats() {
  return computeFocusStats(loadSessions());
}

/**
 * Get available sprint presets.
 */
function getSprintPresets() {
  return [...SPRINT_PRESETS];
}

module.exports = {
  startSession,
  endSession,
  recordEntry,
  getActiveSession,
  isSessionActive,
  getSessionHistory,
  getFocusStats,
  getSprintPresets,
  SPRINT_PRESETS,
};
