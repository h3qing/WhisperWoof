/**
 * Vocabulary Pack type definitions and schema validation.
 *
 * A vocabulary pack is a curated collection of terms that ship with
 * the app or are user-installed. Packs live in a separate layer from
 * user vocabulary — enabling clean uninstall, version tracking, and
 * smart merging into the STT hint pipeline.
 *
 * @typedef {Object} PackEntry
 * @property {string} word - The correct spelling/form
 * @property {string[]} [alternatives] - How STT might hear it (phonetic variants)
 * @property {string} [category] - Entry-level category override (names | technical | abbreviation | general | cultural | brand | food | place | medical)
 *
 * @typedef {Object} VocabularyPack
 * @property {string} id - Unique pack identifier (kebab-case, e.g. "food-and-drink")
 * @property {string} name - Human-readable display name
 * @property {string} description - One-line description for the pack browser
 * @property {string} version - Semver string (e.g. "1.0.0")
 * @property {string} author - Pack author
 * @property {string} category - Pack-level category for grouping in UI
 * @property {string[]} [tags] - Searchable tags
 * @property {boolean} [defaultEnabled] - If true, enabled on first install
 * @property {PackEntry[]} entries - The vocabulary entries
 *
 * @typedef {Object} PackInstallState
 * @property {string} packId - References VocabularyPack.id
 * @property {boolean} enabled - Whether this pack contributes to STT hints
 * @property {string} installedVersion - Version when user last enabled/updated
 * @property {string[]} [disabledEntries] - Words the user explicitly removed from this pack
 */

const PACK_CATEGORIES = Object.freeze([
  "essentials",
  "food",
  "brands",
  "places",
  "people",
  "culture",
  "tech",
  "medical",
  "finance",
  "gaming",
  "fitness",
  "legal",
]);

/**
 * Validate a pack object has the required shape. Returns `{ valid, errors }`.
 * Does NOT validate individual entry content — just structural correctness.
 */
function validatePack(pack) {
  const errors = [];

  if (!pack || typeof pack !== "object") {
    return { valid: false, errors: ["Pack must be a non-null object"] };
  }

  if (!pack.id || typeof pack.id !== "string") errors.push("Missing or invalid 'id'");
  if (!pack.name || typeof pack.name !== "string") errors.push("Missing or invalid 'name'");
  if (!pack.version || typeof pack.version !== "string") errors.push("Missing or invalid 'version'");
  if (!pack.author || typeof pack.author !== "string") errors.push("Missing or invalid 'author'");
  if (!pack.category || typeof pack.category !== "string") errors.push("Missing or invalid 'category'");

  if (!Array.isArray(pack.entries)) {
    errors.push("'entries' must be an array");
  } else {
    for (let i = 0; i < pack.entries.length; i++) {
      const entry = pack.entries[i];
      if (!entry || typeof entry.word !== "string" || !entry.word.trim()) {
        errors.push(`Entry ${i}: missing or empty 'word'`);
      }
      if (entry.alternatives !== undefined && !Array.isArray(entry.alternatives)) {
        errors.push(`Entry ${i}: 'alternatives' must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute a pack's display stats without loading full entry details.
 */
function packSummary(pack) {
  if (!pack || !Array.isArray(pack.entries)) {
    return { id: pack?.id, entryCount: 0, categories: {} };
  }

  const categories = {};
  for (const entry of pack.entries) {
    const cat = entry.category || "general";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    author: pack.author,
    category: pack.category,
    tags: pack.tags || [],
    defaultEnabled: pack.defaultEnabled || false,
    entryCount: pack.entries.length,
    categories,
  };
}

module.exports = {
  PACK_CATEGORIES,
  validatePack,
  packSummary,
};
