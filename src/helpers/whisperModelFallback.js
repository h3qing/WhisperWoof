/**
 * Pure model-selection logic for Whisper auto-fallback.
 *
 * No fs, no electron — just the priority policy + picker, so it is trivially
 * unit-testable. whisper.js wires it to the filesystem.
 *
 * When a user's selected Whisper model isn't downloaded, we'd rather transcribe
 * with the BEST model they already have than silently download/use a worse one
 * (the old behavior fell back to `tiny`, which can't do Chinese and is weak at
 * English). Multilingual models rank first so a bilingual user is never
 * downgraded onto an English-only model; `tiny` is last.
 */

const WHISPER_FALLBACK_PREFERENCE = Object.freeze([
  "turbo", // large-v3-turbo — multilingual, fast, accurate (best default)
  "large", // large-v3 — multilingual, most accurate
  "medium", // multilingual
  "small", // multilingual
  "base", // multilingual, mediocre
  "distil-large-v3.5", // English-optimized
  "distil-large-v3", // English-optimized
  "tiny", // last resort
]);

/**
 * Pick the best already-downloaded model.
 * @param {string[]} downloadedIds - model ids present on disk
 * @param {string[]} [preference] - ranked best→worst
 * @returns {string|null} best available id, or null if none
 */
function pickBestDownloadedModel(downloadedIds, preference = WHISPER_FALLBACK_PREFERENCE) {
  const set = new Set(downloadedIds || []);
  for (const id of preference) {
    if (set.has(id)) return id;
  }
  // A downloaded model we don't rank (custom id) still beats nothing.
  return (downloadedIds && downloadedIds[0]) || null;
}

module.exports = { WHISPER_FALLBACK_PREFERENCE, pickBestDownloadedModel };
