/**
 * Memory replacements — pure functions.
 *
 * Memory entries carry `alternatives`: how speech gets misheard. They must
 * never go into an STT prompt (they bias Whisper toward the wrong spelling),
 * but they are exactly what to swap out of a transcript: "super base" ->
 * "Supabase". This is the only Memory lever for engines that take no hints
 * (Parakeet, X-ASR, SenseVoice); it runs before polish for every local
 * engine and the batch cloud providers.
 *
 * A swap edits every future transcript, so which alternatives become rules
 * is deliberately strict:
 *   - typed by the user (not in `learnedCounts`): always;
 *   - learned from corrections: only after the same fix twice, and only when
 *     the misheard text can't be something the user really said —
 *       one word: not a real word (checked against a word list; with no
 *         list available, never), and not a number;
 *       several words: no everyday function words ("and I", "a team"), and
 *         the target looks like a name or term (a capital, digit or accent);
 *       never a fix that only extends or trims the text ("10" -> "10am").
 */

const MIN_LEARNED_FIXES = 2;
const MAX_ALTERNATIVES_PER_WORD = 20;
const MAX_RULES = 2000;
const TERM_RE = /[A-Z0-9]|[^\x00-\x7F]/;
const STOPWORDS = new Set(
  (
    "a an the and or but nor so yet if then than as of in on at to for from by with into onto " +
    "about over under up down out off i me my mine you your yours he him his she her hers it its " +
    "we us our ours they them their theirs this that these those is am are was were be been being " +
    "do does did have has had will would shall should can could may might must not no yes oh um uh"
  ).split(" ")
);

// A letter or digit that is not CJK: Chinese/Japanese/Korean text has no
// spaces, so a CJK character next to "super base" is still a word boundary.
const WORD_CHAR =
  "(?![\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}])[\\p{L}\\p{N}]";
// Also part of a word: apostrophes and underscores ("don't", "my_base"), and a
// dot between letters ("base.py"). A sentence-ending dot is not.
const BEFORE = `(?<!${WORD_CHAR}|['’_]|[\\p{L}\\p{N}]\\.)`;
const AFTER = `(?!${WORD_CHAR}|['’_]|\\.[\\p{L}\\p{N}])`;

function normalizePhrase(text) {
  return text.toLowerCase().split(/[\s-]+/).filter(Boolean).join(" ");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLearnedRuleSafe(from, to, isKnownWord) {
  const fromKey = normalizePhrase(from);
  const fromCompact = fromKey.replace(/ /g, "");
  const toCompact = normalizePhrase(to).replace(/ /g, "");
  if (toCompact.includes(fromCompact) || fromCompact.includes(toCompact)) return false;

  const words = fromKey.split(" ");
  if (words.length === 1) {
    if (/^\p{N}+$/u.test(fromKey)) return false;
    return typeof isKnownWord === "function" && !isKnownWord(fromKey);
  }
  if (words.some((w) => STOPWORDS.has(w))) return false;
  return TERM_RE.test(to);
}

/** Candidate rules of one entry, each with its priority (typed beats learned). */
function entryCandidates(entry, isKnownWord) {
  if (!entry || typeof entry.word !== "string" || !Array.isArray(entry.alternatives)) return [];
  const counts = entry.learnedCounts || {};
  const out = [];
  for (const alt of entry.alternatives.slice(0, MAX_ALTERNATIVES_PER_WORD)) {
    if (typeof alt !== "string") continue;
    const from = alt.trim();
    const key = normalizePhrase(from);
    if (!key || key === normalizePhrase(entry.word)) continue;
    const learned = counts[from.toLowerCase()];
    if (learned === undefined) {
      out.push({ from, to: entry.word, key, priority: Infinity });
    } else if (learned >= MIN_LEARNED_FIXES && isLearnedRuleSafe(from, entry.word, isKnownWord)) {
      out.push({ from, to: entry.word, key, priority: learned });
    }
  }
  return out;
}

/**
 * @param {Array<{word: string, alternatives?: string[], learnedCounts?: Object<string, number>}>} entries
 * @param {{isKnownWord?: (word: string) => boolean}} [options] - Word-list lookup for single-word rules
 * @returns {{from: string, to: string}[]} Longest `from` first, one rule per mishearing
 */
function buildReplacementRules(entries, { isKnownWord } = {}) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .flatMap((entry) => entryCandidates(entry, isKnownWord))
    .sort((a, b) => b.priority - a.priority); // stable: earlier entries win ties

  const seen = new Set();
  const rules = [];
  for (const { from, to, key } of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ from, to });
  }
  return rules.sort((a, b) => b.from.length - a.from.length).slice(0, MAX_RULES);
}

/** Build the matcher once per rule set (see applyCompiledReplacements). */
function compileReplacements(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const byKey = new Map(rules.map((r) => [normalizePhrase(r.from), r.to]));
  const alternation = rules
    .map((r) => r.from.trim().split(/[\s-]+/).map(escapeRegExp).join("[\\s-]+"))
    .join("|");
  return { re: new RegExp(`${BEFORE}(?:${alternation})${AFTER}`, "giu"), byKey };
}

/**
 * Swap every whole-word, case-insensitive match of a rule's `from` (spaces
 * and hyphens between its words are interchangeable) for its `to`, in one
 * pass so a replacement is never replaced again.
 *
 * @returns {{text: string, applied: {from: string, to: string}[]}}
 */
function applyCompiledReplacements(text, compiled) {
  if (!text || !compiled) return { text, applied: [] };
  const applied = [];
  const replaced = text.replace(compiled.re, (match) => {
    const to = compiled.byKey.get(normalizePhrase(match));
    if (to === undefined) return match;
    applied.push({ from: match, to });
    return to;
  });
  return { text: replaced, applied };
}

function applyReplacements(text, rules) {
  return applyCompiledReplacements(text, compileReplacements(rules));
}

/**
 * A lookup into a newline-separated word list (e.g. /usr/share/dict/words),
 * case-insensitive. Returns null when there is no list.
 */
function makeKnownWordChecker(wordListText) {
  if (typeof wordListText !== "string" || wordListText.trim() === "") return null;
  const haystack = `\n${wordListText.toLowerCase()}\n`;
  return (word) => haystack.includes(`\n${String(word).toLowerCase()}\n`);
}

/**
 * Split a paste's correction pairs into ones that undo a swap Memory made in
 * that same text (the user changed "Supabase" back to "super base") and the
 * rest. A reversal means the rule was wrong here; it must not be learned as a
 * new rule the other way round.
 *
 * @param {{from: string, to: string}[]} pairs
 * @param {{from: string, to: string}[]} swaps - Replacements applied to the pasted text
 * @returns {{reversals: {from: string, to: string}[], rest: {from: string, to: string}[]}}
 */
function splitReversals(pairs, swaps) {
  const reversals = [];
  const rest = [];
  for (const pair of pairs) {
    const swap = (swaps || []).find(
      (s) => normalizePhrase(s.to) === normalizePhrase(pair.from) && normalizePhrase(s.from) === normalizePhrase(pair.to)
    );
    if (swap) reversals.push({ from: swap.from, to: swap.to });
    else rest.push(pair);
  }
  return { reversals, rest };
}

/**
 * One pasted text produces a debounced edit event per pause in typing.
 * Within it, each mishearing is recorded once and maps to its latest fix,
 * so a pause mid-word can't leave "super base" -> "Supa" behind once the
 * user finishes typing "Supabase".
 *
 * @param {{from: string, to: string}[]} pairs - Pairs from the latest edit
 * @param {Map<string, string>} session - Lowercased `from` -> `to` recorded for this paste
 * @returns {{record: {from: string, to: string}[], revert: {from: string, to: string}[], session: Map<string, string>}}
 */
function planSessionLearning(pairs, session) {
  const next = new Map(session);
  const record = [];
  const revert = [];
  for (const pair of pairs) {
    const key = pair.from.toLowerCase();
    const previous = next.get(key);
    if (previous === pair.to) continue;
    if (previous !== undefined) revert.push({ from: pair.from, to: previous });
    record.push(pair);
    next.set(key, pair.to);
  }
  return { record, revert, session: next };
}

module.exports = {
  MIN_LEARNED_FIXES,
  MAX_ALTERNATIVES_PER_WORD,
  buildReplacementRules,
  compileReplacements,
  applyCompiledReplacements,
  applyReplacements,
  makeKnownWordChecker,
  splitReversals,
  planSessionLearning,
};
