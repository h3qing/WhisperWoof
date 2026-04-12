/**
 * Custom Vocabulary Manager — User-managed word/phrase dictionary
 *
 * Extends OpenWhispr's AutoLearn dictionary with:
 * - Categories (names, technical, abbreviations, general)
 * - Pronunciation hints (how the STT might hear it)
 * - Usage tracking (how often each word appears in transcripts)
 * - Bulk import/export
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-vocabulary.json
 * Also syncs to OpenWhispr's custom_dictionary table for STT hints.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  MAX_ENTRIES,
  filterVocabulary,
  isDuplicateWord,
  flattenSttHints,
  computeVocabularyStats,
  planVocabularyImport,
} = require("./vocabulary-pure");

const VOCAB_FILE = path.join(app.getPath("userData"), "whisperwoof-vocabulary.json");
const FLUSH_INTERVAL_MS = 30_000; // Flush cache to disk every 30 seconds

/**
 * @typedef {Object} VocabEntry
 * @property {string} id
 * @property {string} word - The correct spelling/form
 * @property {string} category - names | technical | abbreviation | general
 * @property {string[]} alternatives - How STT might transcribe it (phonetic variants)
 * @property {string} createdAt
 * @property {string} source - manual | auto-learn | import
 * @property {number} usageCount
 * @property {Object<string, {count: number, firstSeen: string, lastSeen: string}>} [appContexts] - Per-app usage tracking
 */

// In-memory cache to avoid disk I/O on every incrementUsage call
let _vocabCache = null;
let _cacheFlushTimer = null;
let _cacheDirty = false;

function loadVocabulary() {
  if (_vocabCache !== null) return _vocabCache;
  try {
    if (fs.existsSync(VOCAB_FILE)) {
      const data = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
      _vocabCache = Array.isArray(data) ? data : [];
      return _vocabCache;
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load vocabulary", { error: err.message });
  }
  _vocabCache = [];
  return _vocabCache;
}

function saveVocabulary(entries) {
  _vocabCache = entries;
  _cacheDirty = true;
  flushToDisk();
}

function flushToDisk() {
  if (!_cacheDirty || _vocabCache === null) return;
  try {
    fs.writeFileSync(VOCAB_FILE, JSON.stringify(_vocabCache, null, 2), "utf-8");
    _cacheDirty = false;
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save vocabulary", { error: err.message });
  }
}

function markDirty() {
  _cacheDirty = true;
  // Start periodic flush if not already running
  if (!_cacheFlushTimer) {
    _cacheFlushTimer = setInterval(flushToDisk, FLUSH_INTERVAL_MS);
  }
}

function invalidateCache() {
  flushToDisk();
  _vocabCache = null;
  if (_cacheFlushTimer) {
    clearInterval(_cacheFlushTimer);
    _cacheFlushTimer = null;
  }
}

// --- CRUD ---

function getVocabulary(options = {}) {
  return filterVocabulary(loadVocabulary(), options);
}

function addWord(word, options = {}) {
  if (!word || !word.trim()) return { success: false, error: "Word is required" };

  const trimmed = word.trim();
  const entries = loadVocabulary();

  if (isDuplicateWord(entries, trimmed)) {
    return { success: false, error: `"${trimmed}" already exists` };
  }

  if (entries.length >= MAX_ENTRIES) {
    return { success: false, error: `Maximum ${MAX_ENTRIES} vocabulary entries reached` };
  }

  const now = new Date().toISOString();
  const appContexts = {};
  if (options.bundleId) {
    appContexts[options.bundleId] = { count: 1, firstSeen: now, lastSeen: now };
  }

  const entry = {
    id: `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    word: trimmed,
    category: options.category || "general",
    alternatives: (options.alternatives || []).map((a) => a.trim()).filter(Boolean),
    createdAt: now,
    source: options.source || "manual",
    usageCount: 0,
    appContexts,
  };

  const updated = [...entries, entry];
  saveVocabulary(updated);

  debugLogger.info("[WhisperWoof] Vocabulary word added", { word: trimmed, category: entry.category });
  return { success: true, entry };
}

function updateWord(id, updates) {
  const entries = loadVocabulary();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return { success: false, error: "Word not found" };

  const allowed = {};
  if (updates.word !== undefined) allowed.word = updates.word.trim();
  if (updates.category !== undefined) allowed.category = updates.category;
  if (updates.alternatives !== undefined) {
    allowed.alternatives = updates.alternatives.map((a) => a.trim()).filter(Boolean);
  }

  // Check uniqueness if word changed
  if (allowed.word && allowed.word.toLowerCase() !== entries[idx].word.toLowerCase()) {
    if (entries.some((e, i) => i !== idx && e.word.toLowerCase() === allowed.word.toLowerCase())) {
      return { success: false, error: `"${allowed.word}" already exists` };
    }
  }

  const updated = [...entries];
  updated[idx] = { ...updated[idx], ...allowed };
  saveVocabulary(updated);

  return { success: true, entry: updated[idx] };
}

function removeWord(id) {
  const entries = loadVocabulary();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) {
    return { success: false, error: "Word not found" };
  }
  saveVocabulary(filtered);
  return { success: true };
}

function removeAllWords() {
  saveVocabulary([]);
  return { success: true };
}

// --- Bulk operations ---

function importWords(words, category = "general") {
  if (!Array.isArray(words)) return { success: false, error: "Words must be an array" };

  const entries = loadVocabulary();
  const { additions } = planVocabularyImport(entries, words, category);

  if (additions.length > 0) {
    saveVocabulary([...entries, ...additions]);
  }

  return { success: true, added: additions.length, total: entries.length + additions.length };
}

function exportWords() {
  return loadVocabulary();
}

// --- Usage tracking ---

function incrementUsage(word, bundleId) {
  const entries = loadVocabulary();
  const normalizedWord = word.trim().toLowerCase();

  const idx = entries.findIndex((e) => e.word.toLowerCase() === normalizedWord);
  if (idx === -1) return;

  const now = new Date().toISOString();
  const entry = entries[idx];
  const updatedEntry = { ...entry, usageCount: (entry.usageCount || 0) + 1 };

  // Track per-app context
  if (bundleId) {
    const contexts = { ...(entry.appContexts || {}) };
    const existing = contexts[bundleId];
    if (existing) {
      contexts[bundleId] = { ...existing, count: existing.count + 1, lastSeen: now };
    } else {
      contexts[bundleId] = { count: 1, firstSeen: now, lastSeen: now };
    }
    updatedEntry.appContexts = contexts;
  }

  entries[idx] = updatedEntry;
  _vocabCache = entries;
  markDirty(); // Deferred flush instead of immediate disk write
}

// --- STT hint list ---

/**
 * Get vocabulary filtered and sorted by a specific app context.
 * Returns entries that have been used in the given app, sorted by that app's usage count.
 */
function getVocabularyForApp(bundleId) {
  const entries = loadVocabulary();
  return entries
    .filter((e) => e.appContexts && e.appContexts[bundleId])
    .sort((a, b) => {
      const aCount = a.appContexts[bundleId]?.count || 0;
      const bCount = b.appContexts[bundleId]?.count || 0;
      return bCount - aCount;
    })
    .map((e) => ({
      ...e,
      appCount: e.appContexts[bundleId].count,
      appFirstSeen: e.appContexts[bundleId].firstSeen,
      appLastSeen: e.appContexts[bundleId].lastSeen,
    }));
}

/**
 * Get all unique app bundleIds that have vocabulary data.
 */
function getTrackedApps() {
  const entries = loadVocabulary();
  const apps = {};
  for (const entry of entries) {
    for (const [bundleId, ctx] of Object.entries(entry.appContexts || {})) {
      if (!apps[bundleId]) {
        apps[bundleId] = { bundleId, wordCount: 0, totalUsage: 0 };
      }
      apps[bundleId].wordCount++;
      apps[bundleId].totalUsage += ctx.count;
    }
  }
  return Object.values(apps).sort((a, b) => b.totalUsage - a.totalUsage);
}

/**
 * Get a flat list of all words + alternatives for STT hint injection.
 * When bundleId is provided, boost app-specific words to the front.
 */
function getSttHints(bundleId) {
  return flattenSttHints(loadVocabulary(), bundleId);
}

/**
 * Get vocabulary stats including per-app breakdown.
 *
 * Delegates the pure math (category counts, top-used, source
 * breakdown) to vocabulary-pure and layers in the per-app tracking
 * which needs disk-backed data.
 */
function getVocabularyStats() {
  const entries = loadVocabulary();
  return {
    ...computeVocabularyStats(entries),
    trackedApps: getTrackedApps(),
  };
}

module.exports = {
  getVocabulary,
  addWord,
  updateWord,
  removeWord,
  removeAllWords,
  importWords,
  exportWords,
  incrementUsage,
  getSttHints,
  getVocabularyStats,
  getVocabularyForApp,
  getTrackedApps,
  invalidateCache,
  flushToDisk,
};
