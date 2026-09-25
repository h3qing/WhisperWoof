/**
 * Pure logic for Settings Export/Import.
 *
 * No file I/O, no electron. Shared between settings-export.js (which layers
 * on config-file reading + writing) and settings-export.test.ts.
 *
 * Split out so the security-sensitive checks — API-key stripping and bundle
 * identity validation — live in one place that both production and tests
 * exercise. Previously these helpers existed only inside `exportSettings` /
 * `importSettings` as inline code, and the test file kept a parallel copy
 * that could drift silently.
 */

const path = require("path");

const EXPORT_VERSION = 1;

// Save/open dialogs only offer .json, and the main process re-checks the
// chosen path — settings files are never written over, or read from,
// anything else (e.g. ~/.zshrc).
const SETTINGS_FILE_FILTERS = [{ name: "WhisperWoof Settings", extensions: ["json"] }];

// Everything exportSettings can put under `data`.
const EXPORT_DATA_KEYS = ["vocabulary", "styleExamples", "plugins", "appPresetMap", "preferences"];

// Lowercase substrings that mark a field as secret. We lowercase the key
// before matching so camelCase (openaiApiKey) and kebab-case
// (whisperwoof-openai-api-key) both get caught.
//
// IMPORTANT: the app stores real keys as openaiApiKey / anthropicApiKey
// etc. in src/stores/settingsStore.ts, so the filter MUST catch
// camelCase. A previous version used String.includes with the exact
// marker "apiKey" (lowercase 'a'), which silently failed to match
// "openaiApiKey" (capital 'A' after "openai") and would have leaked
// every API key in every settings export.
const API_KEY_MARKERS = ["apikey", "api-key", "api_key", "token", "secret", "bearer"];

/**
 * Strip likely-secret fields from a preferences object so exports don't
 * leak credentials. Returns a new object — the input is not mutated.
 * A field is stripped if its lowercased key contains any API_KEY_MARKER.
 */
function stripApiKeys(prefs) {
  if (!prefs || typeof prefs !== "object") return {};
  const safe = { ...prefs };
  for (const key of Object.keys(safe)) {
    const lower = key.toLowerCase();
    if (API_KEY_MARKERS.some((marker) => lower.includes(marker))) {
      delete safe[key];
    }
  }
  return safe;
}

/**
 * Validate that a bundle is a well-formed WhisperWoof export.
 * Returns null if valid, or a human-readable error string.
 */
function validateBundle(bundle) {
  if (!bundle || !bundle.data) return "Invalid bundle: missing data";
  if (bundle.appName !== "WhisperWoof") return "Invalid bundle: not a WhisperWoof export";
  return null;
}

/**
 * Identity key used to deduplicate an item during merge.
 * Prefers stable ids, then domain-specific natural keys (word / trigger),
 * and falls back to a JSON fingerprint for shape-only items.
 */
function itemIdentity(item) {
  if (!item || typeof item !== "object") return JSON.stringify(item);
  return item.id || item.word || item.trigger || JSON.stringify(item);
}

/**
 * Merge two arrays of items, keeping all existing items and appending any
 * incoming items that aren't already present. Dedup is by itemIdentity.
 * Returns `{ merged, added }` so callers can report how many new items
 * were actually imported.
 */
function mergeArrays(existing, incoming) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];

  const seen = new Set();
  for (const item of existingList) {
    seen.add(itemIdentity(item));
  }

  const newItems = incomingList.filter((item) => !seen.has(itemIdentity(item)));

  return { merged: [...existingList, ...newItems], added: newItems.length };
}

/**
 * True if the path names a .json file. A dotfile literally called ".json"
 * has no extension, so it doesn't count.
 */
function isJsonFilePath(filePath) {
  return typeof filePath === "string" && path.extname(filePath).toLowerCase() === ".json";
}

/**
 * Default export file name, dated with the local day.
 */
function exportFileName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `whisperwoof-settings-${day}.json`;
}

/**
 * Parse an import file's text. The parse error is dropped on purpose:
 * JSON.parse messages quote the offending text, which would leak file
 * content back to the renderer. JSON that isn't a WhisperWoof export
 * (a credentials file, say) is refused rather than handed back.
 */
function parseImportFile(content) {
  let bundle;
  try {
    bundle = JSON.parse(content);
  } catch {
    return { success: false, error: "Invalid JSON" };
  }
  const invalid = validateBundle(bundle);
  return invalid ? { success: false, error: invalid } : { success: true, bundle };
}

/**
 * Rebuild a renderer-supplied bundle from the export's own fields before it
 * is written, so the file can't gain top-level keys another app would act
 * on (e.g. `hooks` in a settings.json the user is tricked into overwriting),
 * and API keys are stripped even if the renderer skipped exportSettings.
 * Assumes validateBundle already passed. Returns a new object.
 */
function toExportBundle(bundle) {
  const data = Object.fromEntries(
    EXPORT_DATA_KEYS.filter((key) => bundle.data[key] !== undefined).map((key) => [
      key,
      key === "preferences" ? stripApiKeys(bundle.data[key]) : bundle.data[key],
    ]),
  );
  return { version: EXPORT_VERSION, exportedAt: bundle.exportedAt, appName: "WhisperWoof", data };
}

module.exports = {
  EXPORT_VERSION,
  API_KEY_MARKERS,
  SETTINGS_FILE_FILTERS,
  stripApiKeys,
  validateBundle,
  itemIdentity,
  mergeArrays,
  isJsonFilePath,
  exportFileName,
  parseImportFile,
  toExportBundle,
};
