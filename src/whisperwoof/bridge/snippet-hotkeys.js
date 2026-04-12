/**
 * Snippet Hotkeys — Global shortcuts for quick-pasting Smart Clipboard snippets
 *
 * Registers Cmd+Shift+1 through Cmd+Shift+9 (macOS) or Ctrl+Shift+1-9 (Windows/Linux).
 * Each hotkey pastes the snippet assigned to that number.
 *
 * Usage:
 *   const { registerSnippetHotkeys, unregisterSnippetHotkeys } = require('./snippet-hotkeys');
 *   registerSnippetHotkeys(db, clipboardManager);
 */

const { globalShortcut } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { mapSnippetRow } = require("./snippet-hotkeys-pure");

const HOTKEY_COUNT = 9;

/**
 * Look up a snippet by its hotkey number from the database.
 * Returns the camelCase-mapped snippet or null.
 */
function getSnippetByHotkey(db, hotkeyNumber) {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM bf_snippets WHERE hotkey = ?").get(String(hotkeyNumber));
    if (!row) return null;
    return mapSnippetRow(row);
  } catch (error) {
    debugLogger.log(`[SnippetHotkeys] Failed to look up hotkey ${hotkeyNumber}: ${error.message}`);
    return null;
  }
}

/**
 * Record a snippet usage (increment use_count, update last_used_at).
 */
function recordUse(db, snippetId) {
  if (!db) return;
  try {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE bf_snippets SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, snippetId);
  } catch (error) {
    debugLogger.log(`[SnippetHotkeys] Failed to record use for ${snippetId}: ${error.message}`);
  }
}

/**
 * Register global shortcuts Cmd/Ctrl+Shift+1 through Cmd/Ctrl+Shift+9.
 * Each shortcut pastes the snippet with that hotkey number.
 *
 * @param {object} db - The better-sqlite3 database instance
 * @param {object} clipboardManager - The ClipboardManager instance (from src/helpers/clipboard.js)
 * @returns {number} Number of hotkeys successfully registered
 */
function registerSnippetHotkeys(db, clipboardManager) {
  const modifier = process.platform === "darwin" ? "Command+Shift" : "Control+Shift";
  let registered = 0;

  for (let i = 1; i <= HOTKEY_COUNT; i++) {
    const accelerator = `${modifier}+${i}`;
    try {
      if (globalShortcut.isRegistered(accelerator)) {
        debugLogger.log(`[SnippetHotkeys] ${accelerator} already registered, skipping`);
        continue;
      }

      const success = globalShortcut.register(accelerator, async () => {
        const snippet = getSnippetByHotkey(db, i);
        if (!snippet) {
          debugLogger.log(`[SnippetHotkeys] No snippet assigned to hotkey ${i}`);
          return;
        }

        debugLogger.log(`[SnippetHotkeys] Pasting snippet "${snippet.title}" (hotkey ${i})`);
        try {
          await clipboardManager.pasteText(snippet.content, { restoreClipboard: true });
          recordUse(db, snippet.id);
          debugLogger.log(`[SnippetHotkeys] Pasted successfully. Use count: ${snippet.useCount + 1}`);
        } catch (error) {
          debugLogger.log(`[SnippetHotkeys] Paste failed: ${error.message}`);
        }
      });

      if (success) {
        registered++;
        debugLogger.log(`[SnippetHotkeys] Registered ${accelerator}`);
      } else {
        debugLogger.log(`[SnippetHotkeys] Failed to register ${accelerator}`);
      }
    } catch (error) {
      debugLogger.log(`[SnippetHotkeys] Error registering ${accelerator}: ${error.message}`);
    }
  }

  debugLogger.log(`[SnippetHotkeys] Registered ${registered}/${HOTKEY_COUNT} snippet hotkeys`);
  return registered;
}

/**
 * Unregister all snippet hotkeys. Call on app shutdown.
 */
function unregisterSnippetHotkeys() {
  const modifier = process.platform === "darwin" ? "Command+Shift" : "Control+Shift";
  for (let i = 1; i <= HOTKEY_COUNT; i++) {
    const accelerator = `${modifier}+${i}`;
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // Ignore — may not have been registered
    }
  }
  debugLogger.log("[SnippetHotkeys] All snippet hotkeys unregistered");
}

module.exports = {
  registerSnippetHotkeys,
  unregisterSnippetHotkeys,
};
