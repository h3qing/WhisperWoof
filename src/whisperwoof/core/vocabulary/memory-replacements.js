/**
 * Memory replacements — pure functions.
 *
 * Memory entries carry `alternatives`: how speech gets misheard. They must
 * never go into an STT prompt (they bias Whisper toward the wrong spelling),
 * but they are exactly what to swap out of a transcript: "super base" ->
 * "Supabase". This is the only Memory lever for engines that take no hints
 * (Parakeet, X-ASR, SenseVoice), and it runs before polish for all of them.
 *
 * Which alternatives become rules:
 *   - typed by the user (not in `learnedCounts`): always;
 *   - learned from a correction: only when the corrected word looks like a
 *     term (a capital, digit or non-ASCII letter, never "their" -> "there"),
 *     and the mishearing is a multi-word phrase or was fixed at least twice.
 */

const MIN_SINGLE_WORD_FIXES = 2;
const TERM_RE = /[A-Z0-9]|[^\x00-\x7F]/;
// A letter or digit that is not CJK: Chinese/Japanese/Korean text has no
// spaces, so a CJK character next to "super base" is still a word boundary.
const WORD_CHAR =
  "(?![\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}])[\\p{L}\\p{N}]";

function normalizePhrase(text) {
  return text.toLowerCase().split(/[\s-]+/).filter(Boolean).join(" ");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRuleWorthy(entry, from) {
  const learned = (entry.learnedCounts || {})[from.toLowerCase()];
  if (learned === undefined) return true;
  if (!TERM_RE.test(entry.word)) return false;
  return /\s/.test(from) || learned >= MIN_SINGLE_WORD_FIXES;
}

/**
 * @param {Array<{word: string, alternatives?: string[], learnedCounts?: Object<string, number>}>} entries
 * @returns {{from: string, to: string}[]} Longest `from` first, one rule per mishearing
 */
function buildReplacementRules(entries) {
  const seen = new Set();
  const rules = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const alt of entry.alternatives || []) {
      const from = alt.trim();
      const key = normalizePhrase(from);
      if (!key || key === normalizePhrase(entry.word) || seen.has(key)) continue;
      if (!isRuleWorthy(entry, from)) continue;
      seen.add(key);
      rules.push({ from, to: entry.word });
    }
  }
  return rules.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Swap every whole-word, case-insensitive match of a rule's `from` (spaces
 * and hyphens between its words are interchangeable) for its `to`, in one
 * pass so a replacement is never replaced again.
 *
 * @returns {{text: string, applied: {from: string, to: string}[]}}
 */
function applyReplacements(text, rules) {
  if (!text || !Array.isArray(rules) || rules.length === 0) return { text, applied: [] };

  const byKey = new Map(rules.map((r) => [normalizePhrase(r.from), r.to]));
  const alternation = rules
    .map((r) => r.from.trim().split(/[\s-]+/).map(escapeRegExp).join("[\\s-]+"))
    .join("|");
  const re = new RegExp(`(?<!${WORD_CHAR})(?:${alternation})(?!${WORD_CHAR})`, "giu");

  const applied = [];
  const replaced = text.replace(re, (match) => {
    const to = byKey.get(normalizePhrase(match));
    if (to === undefined) return match;
    applied.push({ from: match, to });
    return to;
  });
  return { text: replaced, applied };
}

module.exports = { MIN_SINGLE_WORD_FIXES, buildReplacementRules, applyReplacements };
