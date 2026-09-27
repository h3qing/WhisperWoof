/**
 * History search text → an FTS5 MATCH query. Each word becomes a quoted
 * prefix term, so punctuation (don't, C++, "), operators (NOT, OR) and
 * column filters (raw_text:x) are searched for as text instead of being
 * parsed as query syntax. Empty input gives null (no search).
 */
function toFtsQuery(text) {
  if (typeof text !== "string") return null;
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/\0/g, ""))
    .filter((t) => t !== "")
    .slice(0, 32);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

/** A LIMIT the database can take: an integer from 1 to 500. */
function clampLimit(limit, fallback = 50) {
  const n = Number(limit);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 500) : fallback;
}

module.exports = { toFtsQuery, clampLimit };
