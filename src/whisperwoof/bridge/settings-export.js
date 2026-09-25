/**
 * Settings Export/Import — Portable WhisperWoof configuration
 *
 * Bundles all WhisperWoof settings into a single JSON file for backup,
 * migration, or sharing between machines.
 *
 * Exported data:
 * - Vocabulary (custom words, categories, alternatives)
 * - Style examples (adaptive learning before/after pairs)
 * - Plugin configs (enabled, hotkey bindings)
 * - App-preset map (context-aware polish rules)
 *
 * Does NOT export: API keys, database entries, audio files, Telegram inbox
 */

const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  EXPORT_VERSION,
  SETTINGS_FILE_FILTERS,
  stripApiKeys,
  validateBundle,
  mergeArrays,
  isJsonFilePath,
  exportFileName,
  parseImportFile,
  toExportBundle,
} = require("./settings-export-pure");

const USER_DATA = app.getPath("userData");

const CONFIG_FILES = {
  vocabulary: path.join(USER_DATA, "whisperwoof-vocabulary.json"),
  styleExamples: path.join(USER_DATA, "whisperwoof-style-examples.json"),
  plugins: path.join(USER_DATA, "whisperwoof-plugins.json"),
};

/**
 * Read a JSON config file. Returns null if not found or invalid.
 */
function readConfigFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to read config", { path: filePath, error: err.message });
  }
  return null;
}

/**
 * Write a JSON config file.
 */
function writeConfigFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Export all WhisperWoof settings to a single JSON object.
 *
 * @param {object} options
 * @param {Record<string, string>} options.appPresetMap - From context-detector
 * @param {Record<string, string>} options.localStorageKeys - User prefs from renderer
 * @returns {{ version: number, exportedAt: string, data: object }}
 */
function exportSettings(options = {}) {
  const data = {};

  // Config files
  for (const [key, filePath] of Object.entries(CONFIG_FILES)) {
    const content = readConfigFile(filePath);
    if (content !== null) {
      data[key] = content;
    }
  }

  // App-preset map (passed from renderer/context-detector)
  if (options.appPresetMap) {
    data.appPresetMap = options.appPresetMap;
  }

  // User preferences from localStorage (passed from renderer) — strip
  // API keys via the shared pure helper so tests validate the same gate.
  if (options.localStorageKeys) {
    data.preferences = stripApiKeys(options.localStorageKeys);
  }

  const bundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: "WhisperWoof",
    data,
  };

  // Count what's included
  const stats = {
    vocabulary: Array.isArray(data.vocabulary) ? data.vocabulary.length : 0,
    styleExamples: Array.isArray(data.styleExamples) ? data.styleExamples.length : 0,
    plugins: Array.isArray(data.plugins) ? data.plugins.length : 0,
    preferences: data.preferences ? Object.keys(data.preferences).length : 0,
    appPresetMap: data.appPresetMap ? Object.keys(data.appPresetMap).length : 0,
  };

  debugLogger.info("[WhisperWoof] Settings exported", stats);

  return { bundle, stats };
}

/**
 * Import settings from a previously exported bundle.
 *
 * @param {object} bundle - The exported JSON
 * @param {object} options
 * @param {boolean} options.merge - If true, merge with existing. If false, replace.
 * @returns {{ success: boolean, imported: object, errors: string[] }}
 */
function importSettings(bundle, options = {}) {
  const merge = options.merge !== false; // Default: merge
  const errors = [];
  const imported = {};

  const validationError = validateBundle(bundle);
  if (validationError) {
    return { success: false, imported: {}, errors: [validationError] };
  }

  const { data } = bundle;

  // Import config files
  for (const [key, filePath] of Object.entries(CONFIG_FILES)) {
    if (data[key] === undefined) continue;

    try {
      if (merge) {
        const existing = readConfigFile(filePath) || [];
        const incoming = Array.isArray(data[key]) ? data[key] : [];
        const { merged, added } = mergeArrays(existing, incoming);
        writeConfigFile(filePath, merged);
        imported[key] = { existing: existing.length, added, total: merged.length };
      } else {
        writeConfigFile(filePath, data[key]);
        const count = Array.isArray(data[key]) ? data[key].length : 1;
        imported[key] = { replaced: true, total: count };
      }
    } catch (err) {
      errors.push(`Failed to import ${key}: ${err.message}`);
    }
  }

  // App-preset map import (returned to caller to apply in memory)
  if (data.appPresetMap) {
    imported.appPresetMap = { entries: Object.keys(data.appPresetMap).length };
  }

  // Preferences (returned to caller to apply in localStorage)
  if (data.preferences) {
    imported.preferences = { keys: Object.keys(data.preferences).length };
  }

  debugLogger.info("[WhisperWoof] Settings imported", { imported, errors, merge });

  return {
    success: errors.length === 0,
    imported,
    errors,
    appPresetMap: data.appPresetMap || null,
    preferences: data.preferences || null,
  };
}

const NOT_JSON_ERROR = "Settings files must be .json";

/**
 * Ask the user where to save, then write the exported bundle there.
 * The path always comes from the main-process dialog, never the renderer.
 */
async function saveExportFile(bundle) {
  const invalid = validateBundle(bundle);
  if (invalid) return { success: false, error: invalid };

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export WhisperWoof Settings",
    defaultPath: path.join(app.getPath("documents"), exportFileName(new Date())),
    filters: SETTINGS_FILE_FILTERS,
  });
  if (canceled || !filePath) return { success: false, canceled: true };
  if (!isJsonFilePath(filePath)) return { success: false, error: NOT_JSON_ERROR };

  fs.writeFileSync(filePath, JSON.stringify(toExportBundle(bundle), null, 2), "utf-8");
  return { success: true, path: filePath, sizeBytes: fs.statSync(filePath).size };
}

/**
 * Ask the user for a settings file, then read and parse it.
 * The path always comes from the main-process dialog, never the renderer.
 */
async function loadImportFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Import WhisperWoof Settings",
    properties: ["openFile"],
    filters: SETTINGS_FILE_FILTERS,
  });
  if (canceled || filePaths.length === 0) return { success: false, canceled: true };

  const [filePath] = filePaths;
  if (!isJsonFilePath(filePath)) return { success: false, error: NOT_JSON_ERROR };
  return parseImportFile(fs.readFileSync(filePath, "utf-8"));
}

module.exports = {
  exportSettings,
  importSettings,
  saveExportFile,
  loadImportFile,
  EXPORT_VERSION,
  CONFIG_FILES,
};
