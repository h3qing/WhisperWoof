/**
 * Keybinding Customization — Rebind all hotkeys
 *
 * Stores user keybinding overrides in a JSON file.
 * Merged with defaults at startup — user overrides win.
 *
 * Features:
 * - Rebind any action to a different key combo
 * - Conflict detection (no two actions on same key)
 * - Reset individual or all keybindings to defaults
 * - Export/import keybinding profiles
 * - Validate key combo format
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-keybindings.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  DEFAULT_KEYBINDINGS,
  CATEGORIES,
  isValidKeyCombo,
  mergeWithOverrides,
  detectConflict,
  validateKeybindingBundle,
} = require("./keybindings-pure");

const KEYBINDINGS_FILE = path.join(app.getPath("userData"), "whisperwoof-keybindings.json");

// --- State ---

let userOverrides = null;

function loadOverrides() {
  if (userOverrides !== null) return userOverrides;

  try {
    if (fs.existsSync(KEYBINDINGS_FILE)) {
      userOverrides = JSON.parse(fs.readFileSync(KEYBINDINGS_FILE, "utf-8"));
      return userOverrides;
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load keybindings", { error: err.message });
  }

  userOverrides = {};
  return userOverrides;
}

function saveOverrides() {
  try {
    const dir = path.dirname(KEYBINDINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KEYBINDINGS_FILE, JSON.stringify(userOverrides, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save keybindings", { error: err.message });
  }
}

// --- Merged keybindings ---

/**
 * Get keybindings as a flat array, defaults merged with user overrides.
 * Delegates to mergeWithOverrides in the pure module so the UI, tests,
 * and runtime all see the same shape.
 */
function getKeybindingsList() {
  return mergeWithOverrides(loadOverrides());
}

/**
 * Get keybindings as a map keyed by actionId (legacy callers).
 */
function getKeybindings() {
  const list = getKeybindingsList();
  const result = {};
  for (const binding of list) {
    result[binding.actionId] = binding;
  }
  return result;
}

// --- Rebind ---
// Validation / conflict detection lives in keybindings-pure.js.

/**
 * Rebind an action to a new key combo.
 *
 * @param {string} actionId - The action to rebind
 * @param {string} newKey - The new key combo
 * @returns {{ success: boolean, error?: string, conflict?: string }}
 */
function rebindAction(actionId, newKey) {
  if (!DEFAULT_KEYBINDINGS[actionId]) {
    return { success: false, error: `Unknown action: "${actionId}"` };
  }

  const trimmedKey = (newKey || "").trim();
  if (!trimmedKey) {
    return { success: false, error: "Key combo is required" };
  }

  if (!isValidKeyCombo(trimmedKey)) {
    return { success: false, error: `Invalid key combo: "${trimmedKey}"` };
  }

  const currentList = getKeybindingsList();
  const conflictId = detectConflict(currentList, actionId, trimmedKey);
  if (conflictId) {
    const conflicting = currentList.find((b) => b.actionId === conflictId);
    return {
      success: false,
      error: `Key "${trimmedKey}" is already bound to "${conflicting?.label || conflictId}"`,
      conflict: conflictId,
    };
  }

  const overrides = loadOverrides();
  userOverrides = { ...overrides, [actionId]: { key: trimmedKey } };
  saveOverrides();

  debugLogger.info("[WhisperWoof] Keybinding changed", { actionId, newKey: trimmedKey });
  return { success: true };
}

/**
 * Reset a single action to its default keybinding.
 */
function resetAction(actionId) {
  if (!DEFAULT_KEYBINDINGS[actionId]) {
    return { success: false, error: `Unknown action: "${actionId}"` };
  }

  const overrides = loadOverrides();
  const { [actionId]: _, ...rest } = overrides;
  userOverrides = rest;
  saveOverrides();

  return { success: true, key: DEFAULT_KEYBINDINGS[actionId].key };
}

/**
 * Reset ALL keybindings to defaults.
 */
function resetAll() {
  userOverrides = {};
  saveOverrides();
  return { success: true };
}

// --- Export/Import ---

function exportKeybindings() {
  return {
    version: 1,
    appName: "WhisperWoof",
    type: "keybindings",
    exportedAt: new Date().toISOString(),
    bindings: loadOverrides(),
  };
}

function importKeybindings(data) {
  const bundleError = validateKeybindingBundle(data);
  if (bundleError) return { success: false, error: bundleError };

  // Validate all keys before applying
  let imported = 0;
  const errors = [];

  for (const [actionId, binding] of Object.entries(data.bindings)) {
    if (!DEFAULT_KEYBINDINGS[actionId]) {
      errors.push(`Unknown action: ${actionId}`);
      continue;
    }
    if (binding.key && !isValidKeyCombo(binding.key)) {
      errors.push(`Invalid key for ${actionId}: ${binding.key}`);
      continue;
    }
    imported++;
  }

  if (imported === 0 && errors.length > 0) {
    return { success: false, error: errors.join("; ") };
  }

  // Apply valid bindings
  userOverrides = { ...data.bindings };
  saveOverrides();

  return { success: true, imported, errors };
}

/**
 * Get keybinding categories (for grouped settings UI).
 */
function getCategories() {
  return [...CATEGORIES];
}

module.exports = {
  getKeybindings,
  getKeybindingsList,
  rebindAction,
  resetAction,
  resetAll,
  exportKeybindings,
  importKeybindings,
  getCategories,
  isValidKeyCombo,
  DEFAULT_KEYBINDINGS,
};
