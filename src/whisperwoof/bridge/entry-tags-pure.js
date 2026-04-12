/**
 * Pure logic for Entry Tagging.
 *
 * The rest of `bridge/entry-tags.js` is all SQL against a module-level
 * `db`, which can't be unified with vitest tests (native better-sqlite3
 * isn't loadable in the Node runtime vitest uses). This file pulls out
 * the genuinely pure pieces — tag-name validation and the default color
 * constant — so production `createTag` / `updateTag` and the test suite
 * both drive off the same validation rules.
 *
 * No file I/O, no db, no electron.
 */

/**
 * Max tag name length. Kept here so the UI, the source module, and
 * tests all agree on the limit — a mismatch between them would let the
 * renderer submit a name that the bridge then rejects.
 */
const MAX_TAG_NAME_LENGTH = 50;

/**
 * Default tag color — Mando coat brown. Used when `createTag` is called
 * without an explicit color. Kept as a constant so the branding stays
 * consistent and tests can assert against it without hard-coding.
 */
const DEFAULT_TAG_COLOR = "#A06A3C";

/**
 * Validate a proposed tag name. Returns null if valid, or a
 * human-readable error string otherwise.
 *
 * Rules:
 * - Must be a non-empty string after trimming
 * - Must be MAX_TAG_NAME_LENGTH characters or fewer (after trimming)
 */
function validateTagName(name) {
  if (name === null || name === undefined) return "Tag name is required";
  if (typeof name !== "string") return "Tag name must be a string";
  const trimmed = name.trim();
  if (!trimmed) return "Tag name is required";
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    return `Tag name must be ${MAX_TAG_NAME_LENGTH} characters or less`;
  }
  return null;
}

module.exports = {
  MAX_TAG_NAME_LENGTH,
  DEFAULT_TAG_COLOR,
  validateTagName,
};
