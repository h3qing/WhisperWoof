/**
 * Pure logic for the Custom Vocabulary manager.
 *
 * No file I/O, no electron, no side effects. Shared between
 * vocabulary.js (which layers on the on-disk cache + per-app usage
 * tracking) and vocabulary.test.ts. The production functions fetch
 * entries from disk via `loadVocabulary()` and then hand them to the
 * pure helpers here — tests exercise the same selection/dedup/stats
 * math the runtime uses.
 */

const DEFAULT_CATEGORIES = Object.freeze(["names", "technical", "abbreviation", "general"]);
const MAX_ENTRIES = 1000;

/**
 * Filter + sort a vocabulary list. Shape of `options`:
 *   - category: string (exact match)
 *   - search: string (matches word or any alternative, case-insensitive)
 *   - sortBy: "usage" for usage-descending, otherwise word-ascending
 */
function filterVocabulary(entries, options = {}) {
  let result = Array.isArray(entries) ? [...entries] : [];

  if (options.category) {
    result = result.filter((e) => e.category === options.category);
  }

  if (options.search) {
    const q = options.search.toLowerCase();
    result = result.filter((e) =>
      e.word.toLowerCase().includes(q) ||
      (e.alternatives || []).some((a) => a.toLowerCase().includes(q)),
    );
  }

  if (options.sortBy === "usage") {
    result.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  } else {
    result.sort((a, b) => a.word.localeCompare(b.word));
  }

  return result;
}

/**
 * Case-insensitive duplicate check. Returns true if `word` already
 * exists in the list.
 */
function isDuplicateWord(entries, word) {
  if (!word) return false;
  const normalized = word.trim().toLowerCase();
  return (entries || []).some((e) => e.word.toLowerCase() === normalized);
}

/**
 * Return a flat, deduped list of STT hint strings (every correctly spelled
 * word), newest first so fresh corrections survive prompt truncation.
 * Alternatives are how the STT *mis*hears a word, so they are left out: a
 * Whisper prompt is read as prior context and would bias the model toward
 * the wrong spelling. When `bundleId` is provided, app-specific entries are
 * boosted to the front, ordered by usage count in that app.
 */
function flattenSttHints(entries, bundleId) {
  const list = Array.isArray(entries) ? entries : [];
  const hints = [];
  const seen = new Set();

  const push = (s) => {
    if (!s || seen.has(s)) return;
    hints.push(s);
    seen.add(s);
  };

  if (bundleId) {
    const appEntries = list
      .filter((e) => e.appContexts && e.appContexts[bundleId])
      .sort(
        (a, b) => (b.appContexts[bundleId]?.count || 0) - (a.appContexts[bundleId]?.count || 0),
      );
    for (const entry of appEntries) push(entry.word);
  }

  for (const entry of [...list].reverse()) push(entry.word);

  return hints;
}

/**
 * Compute vocabulary dashboard stats. Takes the full entry list; the
 * runtime wrapper in vocabulary.js loads from disk before delegating.
 */
function computeVocabularyStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const categories = {};
  for (const entry of list) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  }

  const autoLearned = list.filter((e) => e.source === "auto-learn").length;
  const manual = list.filter((e) => e.source === "manual").length;

  const topUsed = [...list]
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 5)
    .map((e) => ({ word: e.word, usageCount: e.usageCount || 0 }));

  return {
    total: list.length,
    max: MAX_ENTRIES,
    autoLearned,
    manual,
    categories,
    topUsed,
  };
}

/**
 * Fold an incoming batch of words into an existing entry list. Returns
 * `{ additions, skipped }` — `additions` is the array of new entry
 * objects to append, `skipped` counts duplicates / empty strings /
 * over-limit hits.
 *
 * `nowIso` + `idFactory` are injected so tests can be deterministic.
 */
function planVocabularyImport(
  entries,
  words,
  category = "general",
  nowIso = new Date().toISOString(),
  idFactory = () => `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
) {
  if (!Array.isArray(words)) return { additions: [], skipped: 0 };

  const existing = new Set((entries || []).map((e) => e.word.toLowerCase()));
  const additions = [];
  let skipped = 0;

  for (const raw of words) {
    const word = typeof raw === "string" ? raw : raw?.word || "";
    const trimmed = word.trim();

    if (!trimmed) {
      skipped++;
      continue;
    }
    if (existing.has(trimmed.toLowerCase())) {
      skipped++;
      continue;
    }
    if ((entries?.length || 0) + additions.length >= MAX_ENTRIES) {
      skipped++;
      continue;
    }

    existing.add(trimmed.toLowerCase());
    additions.push({
      id: idFactory(),
      word: trimmed,
      category: typeof raw === "object" ? raw?.category || category : category,
      alternatives: typeof raw === "object" ? raw?.alternatives || [] : [],
      createdAt: nowIso,
      source: "import",
      usageCount: 0,
    });
  }

  return { additions, skipped };
}

/**
 * Drop auto-learned entries whose word matches one of `words`
 * (case-insensitive). Used when the user undoes a learned correction.
 * Manual and imported entries are kept.
 */
function removeLearnedWords(entries, words) {
  const list = Array.isArray(entries) ? entries : [];
  const remove = new Set((words || []).map((w) => String(w).toLowerCase()));
  return list.filter((e) => !(e.source === "auto-learn" && remove.has(e.word.toLowerCase())));
}

module.exports = {
  DEFAULT_CATEGORIES,
  MAX_ENTRIES,
  filterVocabulary,
  isDuplicateWord,
  flattenSttHints,
  removeLearnedWords,
  computeVocabularyStats,
  planVocabularyImport,
};
