/**
 * Pure logic for the adaptive style learner.
 *
 * No file I/O, no electron, no side effects. Shared between style-learner.js
 * (which handles disk persistence and usage) and style-learner.test.ts.
 */

const MIN_EDIT_DISTANCE_RATIO = 0.05;
const MAX_EDIT_DISTANCE_RATIO = 0.8;
const MIN_EDIT_LENGTH = 10;
const MAX_PROMPT_EXAMPLES = 5;

/**
 * Simple Levenshtein distance, used to decide whether a polished→edited
 * pair represents a meaningful style change worth remembering.
 */
function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
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
 * Decide whether a polished→edited pair is worth recording as a style example.
 * Returns false for identical text, very short text, trivial edits (< 5%
 * change), or massive rewrites (> 80% different).
 */
function shouldRecordStyleExample(polishedText, editedText) {
  if (!polishedText || !editedText) return false;

  const polished = polishedText.trim();
  const edited = editedText.trim();

  if (polished === edited) return false;
  if (polished.length < MIN_EDIT_LENGTH || edited.length < MIN_EDIT_LENGTH) return false;

  const distance = editDistance(polished, edited);
  const maxLen = Math.max(polished.length, edited.length);
  const ratio = distance / maxLen;

  if (ratio < MIN_EDIT_DISTANCE_RATIO) return false;
  if (ratio > MAX_EDIT_DISTANCE_RATIO) return false;

  return true;
}

/**
 * Build a few-shot style-prompt section from a list of examples. Scores each
 * example by similarity of length to the input and recency within the list,
 * keeps the top N, and formats them as Before/After pairs.
 */
function buildPromptFromExamples(inputText, examples) {
  if (!examples || examples.length === 0) return "";

  const inputLen = inputText.length;

  const scored = examples.map((ex, idx) => {
    const lenDiff = Math.abs(ex.polished.length - inputLen) / Math.max(ex.polished.length, inputLen);
    const recency = idx / examples.length;
    const score = (1 - lenDiff) * 0.6 + recency * 0.4;
    return { ...ex, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, MAX_PROMPT_EXAMPLES);

  if (selected.length === 0) return "";

  const lines = selected.map((ex) =>
    `Example:\nBefore: "${ex.polished.slice(0, 200)}"\nAfter: "${ex.edited.slice(0, 200)}"`
  );

  return (
    "\n\nThe user has previously edited polished text in these ways. " +
    "Adapt your style to match their preferences:\n\n" +
    lines.join("\n\n")
  );
}

module.exports = {
  editDistance,
  shouldRecordStyleExample,
  buildPromptFromExamples,
  MIN_EDIT_DISTANCE_RATIO,
  MAX_EDIT_DISTANCE_RATIO,
  MAX_PROMPT_EXAMPLES,
};
