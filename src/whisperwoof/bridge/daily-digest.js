/**
 * Daily Digest — AI-generated summary of all entries in a time period
 *
 * Queries bf_entries for a date range, groups by source/project/tag,
 * and generates a structured summary via LLM.
 *
 * Features:
 * - Daily, weekly, or custom date range
 * - Groups entries by source (voice/clipboard/meeting/import)
 * - Extracts action items, decisions, and key topics
 * - Counts and word stats
 * - Stored digests for history
 *
 * Competitors: Otter (meeting summaries), Fireflies (action items),
 * Audionotes (structured summaries). WhisperWoof applies this to ALL
 * captured entries, not just meetings.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { buildDigestData, DIGEST_PROMPT } = require("./daily-digest-pure");

const DIGESTS_FILE = path.join(app.getPath("userData"), "whisperwoof-digests.json");
const MAX_DIGESTS = 100;

let db = null;

function setDatabase(database) {
  db = database;
}

// --- Query entries for a date range ---

function getEntriesForRange(startDate, endDate) {
  if (!db) return [];

  return db.prepare(`
    SELECT id, created_at, source, raw_text, polished, routed_to, project_id, metadata
    FROM bf_entries
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at ASC
  `).all(startDate, endDate).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    text: r.polished || r.raw_text || "",
    routedTo: r.routed_to,
    projectId: r.project_id,
    metadata: r.metadata,
  }));
}

/**
 * Get entries for today.
 */
function getTodayEntries() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return getEntriesForRange(today.toISOString(), tomorrow.toISOString());
}

/**
 * Get entries for the last N days.
 */
function getEntriesForDays(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return getEntriesForRange(start.toISOString(), end.toISOString());
}

// --- LLM digest generation ---

/**
 * Generate an AI-powered digest using the configured LLM provider.
 *
 * @param {Array} entries - Entries to summarize
 * @param {object} options - { baseUrl, model, timeoutMs }
 * @returns {{ summary: string, generated: boolean, error?: string }}
 */
async function generateDigestSummary(entries, options = {}) {
  if (entries.length === 0) {
    return { summary: "No entries to summarize.", generated: false };
  }

  const baseUrl = options.baseUrl || "http://localhost:11434";
  const model = options.model || "llama3.2:1b";
  const timeoutMs = options.timeoutMs || 15000; // Longer timeout for digest

  // Build the text to summarize
  const entryTexts = entries
    .map((e) => `[${e.source}] ${e.text}`)
    .join("\n\n");

  // Cap at 4000 chars to fit in context window
  const capped = entryTexts.length > 4000
    ? entryTexts.slice(0, 4000) + "\n\n[...truncated]"
    : entryTexts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: DIGEST_PROMPT },
          { role: "user", content: `Here are my ${entries.length} entries from today:\n\n${capped}` },
        ],
        stream: false,
        options: { temperature: 0.3, num_predict: 1024, top_p: 0.9 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return { summary: "", generated: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const summary = data?.message?.content?.trim() || "";

    if (!summary) {
      return { summary: "", generated: false, error: "Empty response" };
    }

    debugLogger.info("[WhisperWoof] Digest generated", {
      entries: entries.length,
      summaryLen: summary.length,
    });

    return { summary, generated: true };
  } catch (err) {
    const message = err.name === "AbortError" ? "Timeout" : err.message;
    return { summary: "", generated: false, error: message };
  }
}

// --- Digest storage ---

function loadDigests() {
  try {
    if (fs.existsSync(DIGESTS_FILE)) {
      return JSON.parse(fs.readFileSync(DIGESTS_FILE, "utf-8"));
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load digests", { error: err.message });
  }
  return [];
}

function saveDigests(digests) {
  try {
    const dir = path.dirname(DIGESTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DIGESTS_FILE, JSON.stringify(digests, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save digests", { error: err.message });
  }
}

/**
 * Save a generated digest to history.
 */
function saveDigest(digest) {
  const digests = loadDigests();
  digests.push(digest);
  const pruned = digests.length > MAX_DIGESTS
    ? digests.slice(digests.length - MAX_DIGESTS)
    : digests;
  saveDigests(pruned);
  return { success: true };
}

/**
 * Get digest history.
 */
function getDigestHistory(limit = 30) {
  return loadDigests().slice(-limit);
}

/**
 * Generate and save a daily digest.
 */
async function createDailyDigest(options = {}) {
  const days = options.days || 1;
  const entries = days === 1 ? getTodayEntries() : getEntriesForDays(days);
  const data = buildDigestData(entries);

  if (data.entryCount === 0) {
    return {
      success: true,
      digest: {
        type: days === 1 ? "daily" : `${days}-day`,
        createdAt: new Date().toISOString(),
        data,
        summary: null,
      },
    };
  }

  const summaryResult = await generateDigestSummary(entries, options);

  const digest = {
    id: `digest-${Date.now()}`,
    type: days === 1 ? "daily" : `${days}-day`,
    createdAt: new Date().toISOString(),
    data,
    summary: summaryResult.summary || null,
    generated: summaryResult.generated,
  };

  saveDigest(digest);

  return { success: true, digest };
}

module.exports = {
  setDatabase,
  getTodayEntries,
  getEntriesForDays,
  buildDigestData,
  generateDigestSummary,
  createDailyDigest,
  getDigestHistory,
  DIGEST_PROMPT,
};
