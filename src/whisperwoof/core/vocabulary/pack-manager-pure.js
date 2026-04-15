/**
 * Pure logic for Vocabulary Pack management.
 *
 * No file I/O, no Electron, no side effects. All functions take data
 * in and return data out. The persistence layer (vocabulary-packs.js)
 * loads packs from disk and delegates to these helpers.
 *
 * Design: Packs live in a SEPARATE layer from user vocabulary.
 * - User vocab: manual additions, auto-learned corrections
 * - Pack vocab: curated, versioned, enable/disable without touching user data
 * - At STT hint time, both layers merge with smart priority selection
 */

const { validatePack, packSummary } = require("./pack-types");

/** Maximum tokens Whisper reads from initial_prompt */
const WHISPER_PROMPT_TOKEN_LIMIT = 224;

/** Rough chars-per-token estimate for comma-separated word lists */
const CHARS_PER_TOKEN = 4;

/** Max characters to stay safely under the 224-token limit */
const MAX_HINT_CHARS = WHISPER_PROMPT_TOKEN_LIMIT * CHARS_PER_TOKEN; // ~896

/**
 * List all available packs with summary metadata (no full entries).
 * Merges each pack's install state so the UI can show enabled/disabled.
 *
 * @param {import('./pack-types').VocabularyPack[]} packs - All loaded packs
 * @param {import('./pack-types').PackInstallState[]} installStates - User's install states
 * @returns {Array<Object>} Pack summaries with install state
 */
function listPacksWithState(packs, installStates) {
  const stateMap = new Map();
  for (const state of installStates || []) {
    stateMap.set(state.packId, state);
  }

  return (packs || []).map((pack) => {
    const summary = packSummary(pack);
    const state = stateMap.get(pack.id);
    return {
      ...summary,
      enabled: state ? state.enabled : false,
      installedVersion: state?.installedVersion || null,
      disabledEntryCount: state?.disabledEntries?.length || 0,
    };
  });
}

/**
 * Compute the initial install state for a pack that has never been seen.
 * Respects the pack's `defaultEnabled` flag.
 *
 * @param {import('./pack-types').VocabularyPack} pack
 * @returns {import('./pack-types').PackInstallState}
 */
function createDefaultInstallState(pack) {
  return {
    packId: pack.id,
    enabled: pack.defaultEnabled === true,
    installedVersion: pack.version,
    disabledEntries: [],
  };
}

/**
 * Enable a pack. Returns a new install state with enabled: true.
 *
 * @param {import('./pack-types').PackInstallState | null} currentState
 * @param {import('./pack-types').VocabularyPack} pack
 * @returns {import('./pack-types').PackInstallState}
 */
function enablePack(currentState, pack) {
  if (currentState) {
    return { ...currentState, enabled: true, installedVersion: pack.version };
  }
  return { ...createDefaultInstallState(pack), enabled: true };
}

/**
 * Disable a pack. Returns a new install state with enabled: false.
 * Preserves user's disabledEntries so re-enabling doesn't lose overrides.
 *
 * @param {import('./pack-types').PackInstallState | null} currentState
 * @param {import('./pack-types').VocabularyPack} pack
 * @returns {import('./pack-types').PackInstallState}
 */
function disablePack(currentState, pack) {
  if (currentState) {
    return { ...currentState, enabled: false };
  }
  return { ...createDefaultInstallState(pack), enabled: false };
}

/**
 * Toggle a specific entry within a pack (user override).
 * If the word is in disabledEntries, remove it; otherwise add it.
 *
 * @param {import('./pack-types').PackInstallState} state
 * @param {string} word
 * @returns {import('./pack-types').PackInstallState}
 */
function togglePackEntry(state, word) {
  const disabled = state.disabledEntries || [];
  const normalized = word.trim().toLowerCase();
  const isDisabled = disabled.some((w) => w.toLowerCase() === normalized);

  return {
    ...state,
    disabledEntries: isDisabled
      ? disabled.filter((w) => w.toLowerCase() !== normalized)
      : [...disabled, word.trim()],
  };
}

/**
 * Get the active entries from a pack, respecting user overrides.
 *
 * @param {import('./pack-types').VocabularyPack} pack
 * @param {import('./pack-types').PackInstallState} state
 * @returns {import('./pack-types').PackEntry[]}
 */
function getActivePackEntries(pack, state) {
  if (!state || !state.enabled) return [];
  if (!pack || !Array.isArray(pack.entries)) return [];

  const disabled = new Set((state.disabledEntries || []).map((w) => w.toLowerCase()));

  return pack.entries.filter((entry) => !disabled.has(entry.word.toLowerCase()));
}

/**
 * Merge pack entries into the STT hint list alongside user vocabulary.
 * Respects the Whisper prompt character limit by truncating with priority:
 *   1. User vocabulary hints (always first — these are personalized)
 *   2. Pack entries from enabled packs (alphabetical by pack, then by entry order)
 *
 * @param {string[]} userHints - From flattenSttHints() in vocabulary-pure.js
 * @param {Array<{pack: import('./pack-types').VocabularyPack, state: import('./pack-types').PackInstallState}>} packStates
 * @param {string} [bundleId] - Current app context for priority boosting
 * @returns {string[]} Merged hint list, truncated to fit Whisper's limit
 */
function mergePackHints(userHints, packStates, bundleId) {
  const seen = new Set();
  const result = [];

  const add = (word) => {
    const normalized = word.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(word);
  };

  // Phase 1: user hints get priority
  for (const hint of userHints || []) {
    add(hint);
  }

  // Phase 2: collect all active pack entries
  for (const { pack, state } of packStates || []) {
    const entries = getActivePackEntries(pack, state);
    for (const entry of entries) {
      add(entry.word);
      for (const alt of entry.alternatives || []) {
        add(alt);
      }
    }
  }

  return result;
}

/**
 * Truncate a hint list to fit within Whisper's initial_prompt token limit.
 * Joins with ", " and keeps dropping from the end until it fits.
 *
 * @param {string[]} hints - Full merged hint list
 * @param {number} [maxChars] - Override for testing
 * @returns {string} Comma-separated string ready for initial_prompt
 */
function truncateHintsToPrompt(hints, maxChars = MAX_HINT_CHARS) {
  if (!hints || hints.length === 0) return "";

  // Try full list first
  const full = hints.join(", ");
  if (full.length <= maxChars) return full;

  // Binary search for the cutoff point
  let lo = 0;
  let hi = hints.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = hints.slice(0, mid).join(", ");
    if (candidate.length <= maxChars) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo > 0 ? hints.slice(0, lo).join(", ") : "";
}

/**
 * Check if a pack has a newer version than what the user installed.
 *
 * @param {import('./pack-types').VocabularyPack} pack
 * @param {import('./pack-types').PackInstallState} state
 * @returns {boolean}
 */
function packHasUpdate(pack, state) {
  if (!state || !state.installedVersion) return false;
  return pack.version !== state.installedVersion;
}

/**
 * Validate all packs in a list and return only the valid ones.
 * Logs validation errors for debugging.
 *
 * @param {Array<Object>} rawPacks
 * @returns {{ valid: import('./pack-types').VocabularyPack[], errors: Array<{id: string, errors: string[]}> }}
 */
function validatePacks(rawPacks) {
  const valid = [];
  const errors = [];

  for (const raw of rawPacks || []) {
    const result = validatePack(raw);
    if (result.valid) {
      valid.push(raw);
    } else {
      errors.push({ id: raw?.id || "unknown", errors: result.errors });
    }
  }

  return { valid, errors };
}

module.exports = {
  WHISPER_PROMPT_TOKEN_LIMIT,
  CHARS_PER_TOKEN,
  MAX_HINT_CHARS,
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
};
