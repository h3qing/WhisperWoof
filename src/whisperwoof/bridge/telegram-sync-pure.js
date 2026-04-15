/**
 * Telegram Sync — Pure transform & filter logic (no electron/fs/debugLogger)
 *
 * Extracted from telegram-sync.js so that tests can import directly
 * without triggering top-level require("electron") / app.getPath.
 */

/**
 * Transform a Telegram inbox entry into a bf_entry-shaped object.
 *
 * @param {object} entry - Raw inbox entry
 * @returns {object} bf_entry-shaped payload for saveWhisperWoofEntry
 */
function transformEntry(entry) {
  return {
    source: "import",
    rawText: entry.rawText,
    polished: entry.polished || null,
    routedTo: "telegram-companion",
    hotkeyUsed: null,
    durationMs: entry.durationSec ? entry.durationSec * 1000 : null,
    projectId: null,
    audioPath: null,
    metadata: {
      telegramFrom: entry.from,
      telegramChatId: entry.chatId,
      telegramEntryId: entry.id,
    },
  };
}

/**
 * Filter entries to only those that haven't been imported yet.
 *
 * @param {Array} entries - Full inbox entries
 * @returns {Array} Entries where imported !== true
 */
function filterPending(entries) {
  return entries.filter((e) => !e.imported);
}

module.exports = {
  transformEntry,
  filterPending,
};
