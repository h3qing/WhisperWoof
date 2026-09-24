/**
 * Extracts transcription corrections by diffing original text against
 * the edited field value: the corrected words (for the custom dictionary)
 * and misheard -> corrected pairs (for Memory replacements).
 */

/** Levenshtein edit distance between two strings */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** Tokenize text into words, stripping punctuation (not accented letters) from edges */
function tokenize(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ""))
    .filter((w) => w.length > 0);
}

// 0.65 allows phonetic corrections like "Shunade" -> "Sinead" (dist 4/7 = 0.57)
// while filtering out unrelated word replacements.
const MAX_DISTANCE = 0.65;
const MAX_BLOCK_WORDS = 6;

/** Edit distance between two phrases relative to the longer one, spaces ignored. */
function phraseDistance(a, b) {
  const x = a.replace(/\s+/g, "").toLowerCase();
  const y = b.replace(/\s+/g, "").toLowerCase();
  return editDistance(x, y) / Math.max(x.length, y.length, 1);
}

/** Every contiguous run of words, as phrases. */
function spans(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) out.push(words.slice(i, j).join(" "));
  }
  return out;
}

/**
 * Turn one block of changed words into misheard -> corrected pairs.
 * Same-size blocks pair word by word when every pair sounds alike ("shunade
 * cuberniz" -> "Sinead Kubernetes"); otherwise the closest-sounding pair of
 * sub-spans wins, so words typed next to a fix ("Supabase today") or a
 * dropped filler ("um") stay out of the pair.
 */
function resolveBlock(from, to) {
  const fromWords = from.split(" ");
  const toWords = to.split(" ");
  if (fromWords.length === toWords.length && fromWords.length > 1) {
    const pairs = fromWords.map((f, i) => [f, toWords[i]]);
    if (pairs.every(([f, t]) => phraseDistance(f, t) <= MAX_DISTANCE)) return pairs;
  }
  if (fromWords.length > MAX_BLOCK_WORDS || toWords.length > MAX_BLOCK_WORDS) return [];

  let best = null;
  for (const f of spans(fromWords)) {
    for (const t of spans(toWords)) {
      const d = phraseDistance(f, t);
      if (!best || d < best.d) best = { f, t, d };
    }
  }
  return best ? [[best.f, best.t]] : [];
}

/**
 * Find the region in fieldValue that corresponds to the pasted originalText.
 * If the field only contains the pasted text, returns fieldValue as-is.
 */
function findEditedRegion(originalText, fieldValue) {
  if (fieldValue.length <= originalText.length * 1.5) {
    return fieldValue;
  }

  const idx = fieldValue.indexOf(originalText);
  if (idx !== -1) {
    return originalText;
  }

  // Sliding window: find the region with highest word overlap
  const origWords = tokenize(originalText);
  const fieldWords = tokenize(fieldValue);
  const windowSize = origWords.length;

  if (fieldWords.length <= windowSize) {
    return fieldValue;
  }

  let bestStart = 0;
  let bestScore = -1;

  for (let i = 0; i <= fieldWords.length - windowSize; i++) {
    let matches = 0;
    for (let j = 0; j < windowSize; j++) {
      if (fieldWords[i + j].toLowerCase() === origWords[j].toLowerCase()) {
        matches++;
      }
    }
    if (matches > bestScore) {
      bestScore = matches;
      bestStart = i;
    }
  }

  // Require at least 30% word overlap to consider it a match
  if (bestScore < windowSize * 0.3) {
    return fieldValue;
  }

  return fieldWords.slice(bestStart, bestStart + windowSize).join(" ");
}

/**
 * Word-level LCS; each maximal block of changed words becomes one
 * [originalPhrase, editedPhrase] pair, so a split word stays whole
 * ("super base" -> "Supabase").
 */
function findSubstitutions(origWords, editedWords) {
  const m = origWords.length;
  const n = editedWords.length;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const aligned = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
      aligned.unshift([origWords[i - 1], editedWords[j - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      aligned.unshift([null, editedWords[j - 1]]);
      j--;
    } else {
      aligned.unshift([origWords[i - 1], null]);
      i--;
    }
  }

  const subs = [];
  let from = [];
  let to = [];
  const flush = () => {
    if (from.length > 0 && to.length > 0) subs.push([from.join(" "), to.join(" ")]);
    from = [];
    to = [];
  };
  for (const [origW, editW] of aligned) {
    if (origW !== null && editW !== null) {
      flush();
      continue;
    }
    if (origW !== null) from = [...from, origW];
    if (editW !== null) to = [...to, editW];
  }
  flush();

  return subs;
}

/**
 * Misheard -> corrected pairs from a user's edits to pasted transcription
 * text. Not filtered by the dictionary, so a repeated fix still counts.
 *
 * @param {string} originalText - The text that was originally pasted
 * @param {string} fieldValue - The current value of the text field
 * @returns {{from: string, to: string}[]}
 */
function extractCorrectionPairs(originalText, fieldValue) {
  if (!originalText || !fieldValue) return [];
  if (originalText === fieldValue) return [];

  const editedRegion = findEditedRegion(originalText, fieldValue);
  if (editedRegion === originalText) return [];

  const origWords = tokenize(originalText);
  const editedWords = tokenize(editedRegion);
  if (origWords.length === 0 || editedWords.length === 0) return [];

  // If more than 50% of words changed, this is a rewrite, not corrections.
  // A block counts its smaller side, so one split word fixed ("super base"
  // -> "Supabase") is one change, even in a two-word dictation.
  const subs = findSubstitutions(origWords, editedWords);
  const changedWords = subs.reduce(
    (n, [from, to]) => n + Math.min(from.split(" ").length, to.split(" ").length),
    0
  );
  if (changedWords > origWords.length * 0.5) return [];

  const seen = new Set();
  const pairs = [];
  for (const [from, to] of subs.flatMap(([f, t]) => resolveBlock(f, t))) {
    const fromKey = from.replace(/\s+/g, "").toLowerCase();
    const toKey = to.replace(/\s+/g, "").toLowerCase();
    if (fromKey === toKey) continue;
    if (toKey.length < 3) continue;
    if (phraseDistance(from, to) > MAX_DISTANCE) continue;

    const pairKey = `${from.toLowerCase()}\u0000${to}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    pairs.push({ from, to });
  }

  return pairs;
}

/**
 * The corrected words of `pairs` that the dictionary doesn't have yet.
 *
 * @param {{from: string, to: string}[]} pairs
 * @param {string[]} existingDictionary
 * @returns {string[]}
 */
function newDictionaryWords(pairs, existingDictionary) {
  const safeDict = Array.isArray(existingDictionary) ? existingDictionary : [];
  const dictSet = new Set(safeDict.map((w) => w.toLowerCase()));
  const seen = new Set();
  const results = [];
  for (const { to } of pairs) {
    const key = to.toLowerCase();
    if (dictSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    results.push(to);
  }
  return results;
}

/**
 * Extract corrected words from a user's edits to pasted transcription text.
 *
 * @param {string} originalText - The text that was originally pasted (from transcription)
 * @param {string} fieldValue - The current value of the text field (after user edits)
 * @param {string[]} existingDictionary - Words already in the custom dictionary
 * @returns {string[]} Corrected words or phrases to add to the dictionary
 */
function extractCorrections(originalText, fieldValue, existingDictionary) {
  return newDictionaryWords(extractCorrectionPairs(originalText, fieldValue), existingDictionary);
}

module.exports = { extractCorrections, extractCorrectionPairs, newDictionaryWords };
