/**
 * Telegram Sync — Imports entries from the Telegram companion bot inbox
 *
 * Polls the telegram-inbox.json file for new entries and imports them
 * into bf_entries. Runs as a background interval in the main process.
 *
 * Architecture: Telegram bot → inbox.json ← desktop poller → bf_entries
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { transformEntry, filterPending } = require("./telegram-sync-pure");

const INBOX_PATH = path.join(app.getPath("userData"), "telegram-inbox.json");
const POLL_INTERVAL_MS = 10000; // Check every 10 seconds

let pollInterval = null;
let saveEntryFn = null;

/**
 * Read the inbox file.
 */
function readInbox() {
  try {
    if (fs.existsSync(INBOX_PATH)) {
      return JSON.parse(fs.readFileSync(INBOX_PATH, "utf-8"));
    }
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Telegram inbox read failed", { error: err.message });
  }
  return [];
}

/**
 * Write the inbox file.
 */
function writeInbox(entries) {
  try {
    fs.writeFileSync(INBOX_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Telegram inbox write failed", { error: err.message });
  }
}

/**
 * Import pending entries from the Telegram inbox into bf_entries.
 */
function importPendingEntries() {
  if (!saveEntryFn) return 0;

  const entries = readInbox();
  const pending = filterPending(entries);

  if (pending.length === 0) return 0;

  let imported = 0;

  for (const entry of pending) {
    try {
      saveEntryFn(transformEntry(entry));
      entry.imported = true;
      imported++;
    } catch (err) {
      debugLogger.debug("[WhisperWoof] Telegram entry import failed", {
        entryId: entry.id,
        error: err.message,
      });
    }
  }

  if (imported > 0) {
    writeInbox(entries);
    debugLogger.info("[WhisperWoof] Telegram sync: imported entries", { count: imported });
  }

  return imported;
}

/**
 * Start polling the Telegram inbox for new entries.
 * @param {Function} saveFn - The saveWhisperWoofEntry function from app-init
 */
function startTelegramSync(saveFn) {
  if (pollInterval) return; // Already running
  saveEntryFn = saveFn;

  // Initial import
  importPendingEntries();

  // Poll periodically
  pollInterval = setInterval(importPendingEntries, POLL_INTERVAL_MS);
  debugLogger.log("[WhisperWoof] Telegram sync started (polling every 10s)");
}

/**
 * Stop polling.
 */
function stopTelegramSync() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    debugLogger.log("[WhisperWoof] Telegram sync stopped");
  }
}

/**
 * Get sync status (for settings UI).
 */
function getTelegramSyncStatus() {
  const entries = readInbox();
  const pending = entries.filter((e) => !e.imported).length;
  const total = entries.length;

  return {
    running: pollInterval !== null,
    inboxPath: INBOX_PATH,
    inboxExists: fs.existsSync(INBOX_PATH),
    pending,
    total,
  };
}

module.exports = {
  startTelegramSync,
  stopTelegramSync,
  getTelegramSyncStatus,
  importPendingEntries,
};
