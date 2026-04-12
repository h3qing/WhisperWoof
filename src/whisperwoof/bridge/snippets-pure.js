/**
 * Pure logic for voice-snippet matching.
 *
 * No file I/O, no electron, no side effects. Shared between snippets.js
 * (which wraps these with on-disk loading + usage tracking) and
 * snippets.test.ts (which imports directly to assert matching rules).
 */

/**
 * Edit distance for short strings (Levenshtein with early-exit for big
 * length gaps). Used by the fuzzy-match branch of matchSnippet.
 */
function simpleEditDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Match transcribed text against a snippet list. Returns a match object
 * (including the matched snippet's id so callers can record usage) or null.
 *
 * Precedence: exact → longest-prefix → fuzzy (1 char off, triggers ≥ 5 chars).
 */
function matchSnippet(transcribedText, snippets) {
  if (!transcribedText || transcribedText.trim().length < 2) return null;

  const input = transcribedText.trim().toLowerCase();

  const exact = snippets.find((s) => input === s.trigger.toLowerCase());
  if (exact) {
    return { matched: true, id: exact.id, trigger: exact.trigger, body: exact.body, matchType: "exact" };
  }

  const prefixMatch = snippets
    .filter((s) => input.startsWith(s.trigger.toLowerCase()))
    .sort((a, b) => b.trigger.length - a.trigger.length)[0];

  if (prefixMatch) {
    return { matched: true, id: prefixMatch.id, trigger: prefixMatch.trigger, body: prefixMatch.body, matchType: "prefix" };
  }

  for (const snippet of snippets) {
    if (snippet.trigger.length < 5) continue;
    const distance = simpleEditDistance(input, snippet.trigger.toLowerCase());
    if (distance <= 1) {
      return { matched: true, id: snippet.id, trigger: snippet.trigger, body: snippet.body, matchType: "fuzzy" };
    }
  }

  return null;
}

module.exports = {
  matchSnippet,
  simpleEditDistance,
};
