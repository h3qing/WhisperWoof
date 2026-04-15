/**
 * Vocabulary Packs — Persistence layer.
 *
 * Loads built-in packs from resources/vocabulary-packs/, manages user
 * install state (enabled/disabled, per-entry overrides), and provides
 * the merged STT hint list that combines user vocabulary + pack data.
 *
 * Storage:
 *   Built-in packs:  resources/vocabulary-packs/*.json  (read-only, ships with app)
 *   Install state:   ~/.config/WhisperWoof/vocabulary-pack-state.json  (user prefs)
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { validatePack } = require("../core/vocabulary/pack-types");
const {
  listPacksWithState,
  createDefaultInstallState,
  enablePack,
  disablePack,
  togglePackEntry,
  getActivePackEntries,
  mergePackHints,
  truncateHintsToPrompt,
  packHasUpdate,
  validatePacks,
} = require("../core/vocabulary/pack-manager-pure");

const STATE_FILE = path.join(app.getPath("userData"), "vocabulary-pack-state.json");

/**
 * Resolve the built-in packs directory. In production the resources/
 * folder is inside the asar archive; in dev it's at the project root.
 */
function getBuiltinPacksDir() {
  const appPath = app.getAppPath();
  // Try resources/ relative to the app path first (dev mode)
  const devPath = path.join(appPath, "resources", "vocabulary-packs");
  if (fs.existsSync(devPath)) return devPath;

  // Production: resources may be one level up from app.asar
  const prodPath = path.join(path.dirname(appPath), "vocabulary-packs");
  if (fs.existsSync(prodPath)) return prodPath;

  // Fallback: extraResources path
  const extraPath = path.join(process.resourcesPath || "", "vocabulary-packs");
  if (fs.existsSync(extraPath)) return extraPath;

  debugLogger.warn("[VocabPacks] Could not find built-in packs directory");
  return devPath; // Return dev path even if missing — callers handle gracefully
}

// --- In-memory cache ---
let _packsCache = null;
let _stateCache = null;

/**
 * Load all built-in pack JSON files from the packs directory.
 * Validates each pack and skips invalid ones.
 */
function loadBuiltinPacks() {
  if (_packsCache !== null) return _packsCache;

  const dir = getBuiltinPacksDir();
  const packs = [];

  try {
    if (!fs.existsSync(dir)) {
      debugLogger.info("[VocabPacks] No packs directory found", { dir });
      _packsCache = [];
      return _packsCache;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        const result = validatePack(raw);
        if (result.valid) {
          packs.push(raw);
        } else {
          debugLogger.warn("[VocabPacks] Invalid pack file", { file, errors: result.errors });
        }
      } catch (err) {
        debugLogger.warn("[VocabPacks] Failed to load pack file", { file, error: err.message });
      }
    }

    debugLogger.info("[VocabPacks] Loaded built-in packs", {
      count: packs.length,
      ids: packs.map((p) => p.id),
    });
  } catch (err) {
    debugLogger.warn("[VocabPacks] Failed to read packs directory", { error: err.message });
  }

  _packsCache = packs;
  return _packsCache;
}

/**
 * Load user's install state from disk. Initializes default states for
 * any packs not yet seen (respecting defaultEnabled).
 */
function loadInstallState() {
  if (_stateCache !== null) return _stateCache;

  let states = [];

  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      states = Array.isArray(data) ? data : [];
    }
  } catch (err) {
    debugLogger.warn("[VocabPacks] Failed to load install state", { error: err.message });
    states = [];
  }

  // Ensure every built-in pack has a state entry
  const packs = loadBuiltinPacks();
  const stateMap = new Map(states.map((s) => [s.packId, s]));
  let changed = false;

  for (const pack of packs) {
    if (!stateMap.has(pack.id)) {
      const defaultState = createDefaultInstallState(pack);
      states = [...states, defaultState];
      changed = true;
    }
  }

  _stateCache = states;
  if (changed) saveInstallState(states);

  return _stateCache;
}

function saveInstallState(states) {
  _stateCache = states;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(states, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[VocabPacks] Failed to save install state", { error: err.message });
  }
}

// --- Public API ---

/**
 * Get all packs with their summaries and install state.
 */
function getAvailablePacks() {
  const packs = loadBuiltinPacks();
  const states = loadInstallState();
  return listPacksWithState(packs, states);
}

/**
 * Get full details for a single pack (including entries).
 */
function getPackDetails(packId) {
  const packs = loadBuiltinPacks();
  const states = loadInstallState();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;

  const state = states.find((s) => s.packId === packId);
  return {
    ...pack,
    enabled: state?.enabled || false,
    installedVersion: state?.installedVersion || null,
    disabledEntries: state?.disabledEntries || [],
    hasUpdate: state ? packHasUpdate(pack, state) : false,
  };
}

/**
 * Enable a pack by ID. Returns the updated state.
 */
function enablePackById(packId) {
  const packs = loadBuiltinPacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return { success: false, error: `Pack "${packId}" not found` };

  const states = loadInstallState();
  const currentState = states.find((s) => s.packId === packId) || null;
  const newState = enablePack(currentState, pack);

  const updated = currentState
    ? states.map((s) => (s.packId === packId ? newState : s))
    : [...states, newState];

  saveInstallState(updated);
  debugLogger.info("[VocabPacks] Pack enabled", { packId });
  return { success: true, state: newState };
}

/**
 * Disable a pack by ID. Returns the updated state.
 */
function disablePackById(packId) {
  const packs = loadBuiltinPacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return { success: false, error: `Pack "${packId}" not found` };

  const states = loadInstallState();
  const currentState = states.find((s) => s.packId === packId) || null;
  const newState = disablePack(currentState, pack);

  const updated = currentState
    ? states.map((s) => (s.packId === packId ? newState : s))
    : [...states, newState];

  saveInstallState(updated);
  debugLogger.info("[VocabPacks] Pack disabled", { packId });
  return { success: true, state: newState };
}

/**
 * Toggle a specific entry within a pack.
 */
function togglePackEntryById(packId, word) {
  const states = loadInstallState();
  const state = states.find((s) => s.packId === packId);
  if (!state) return { success: false, error: `Pack "${packId}" not installed` };

  const newState = togglePackEntry(state, word);
  const updated = states.map((s) => (s.packId === packId ? newState : s));
  saveInstallState(updated);

  return { success: true, state: newState };
}

/**
 * Get enabled packs as ID list.
 */
function getEnabledPackIds() {
  const states = loadInstallState();
  return states.filter((s) => s.enabled).map((s) => s.packId);
}

/**
 * Get the merged STT hints from all enabled packs + user vocabulary.
 * Returns a comma-separated string ready for Whisper's initial_prompt.
 *
 * @param {string[]} userHints - From vocabulary.getSttHints()
 * @param {string} [bundleId] - Current app context
 * @returns {string} Prompt string
 */
function getPackEnhancedSttPrompt(userHints, bundleId) {
  const packs = loadBuiltinPacks();
  const states = loadInstallState();

  const packStates = packs
    .map((pack) => ({
      pack,
      state: states.find((s) => s.packId === pack.id),
    }))
    .filter(({ state }) => state && state.enabled);

  const merged = mergePackHints(userHints, packStates, bundleId);
  return truncateHintsToPrompt(merged);
}

/**
 * Invalidate all caches (e.g., after file changes in dev mode).
 */
function invalidatePackCaches() {
  _packsCache = null;
  _stateCache = null;
}

module.exports = {
  getAvailablePacks,
  getPackDetails,
  enablePackById,
  disablePackById,
  togglePackEntryById,
  getEnabledPackIds,
  getPackEnhancedSttPrompt,
  invalidatePackCaches,
  // Exposed for testing
  getBuiltinPacksDir,
  loadBuiltinPacks,
  loadInstallState,
};
