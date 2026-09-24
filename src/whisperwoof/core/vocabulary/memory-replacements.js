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
 * A swap edits every future transcript, so Memory never switches one on by
 * itself. Rules are only alternatives the user typed or approved. A learned
 * fix becomes an *offer* ("Always change super base to Supabase?") after the
 * same fix twice, and only when the misheard text can't be something the
 * user really said:
 *   one word: not a real word, a plural or past tense of one, or a number
 *     (checked against a word list; with no list available, never offered);
 *   several words: no everyday function words ("and I", "a team"), and the
 *     target looks like a name or term (a capital, digit or accent);
 *   never a fix that only extends or trims the text ("10" -> "10am"), and
 *   never the inverse of a rule that already exists.
 * Declining (or reverting a swap in the pasted text) forgets it for good.
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

// A letter, digit or combining mark that is not CJK: Chinese/Japanese/Korean
// text has no spaces, so a CJK character next to "super base" is a boundary.
const WORD_CHAR =
  "(?![\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}])[\\p{L}\\p{N}\\p{M}]";
// Also part of a word: an apostrophe between letters ("don't"; a possessive
// "'s" still counts as the end), underscores ("my_base") and a dot between
// letters ("base.py"). A sentence-ending dot or a quote mark is not.
const BEFORE = `(?<!${WORD_CHAR}|[\\p{L}\\p{N}]['’]|_|[\\p{L}\\p{N}]\\.)`;
const AFTER = `(?!${WORD_CHAR}|_|\\.[\\p{L}\\p{N}]|['’](?!s(?![\\p{L}\\p{N}\\p{M}]))[\\p{L}\\p{N}])`;

function normalizePhrase(text) {
  return String(text).toLowerCase().split(/[\s-]+/).filter(Boolean).join(" ");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A word, or a plural / past tense / -ing form of one, in the word list. */
function isRealWord(word, isKnownWord) {
  const w = word.replace(/['’]s$/, "");
  const stems = [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ed$/, ""), w.replace(/d$/, ""), w.replace(/ing$/, "")];
  return stems.some((stem) => stem.length >= 2 && isKnownWord(stem));
}

function isOfferSafe(from, to, isKnownWord) {
  const fromKey = normalizePhrase(from);
  const fromCompact = fromKey.replace(/ /g, "");
  const toCompact = normalizePhrase(to).replace(/ /g, "");
  if (toCompact.includes(fromCompact) || fromCompact.includes(toCompact)) return false;

  const words = fromKey.split(" ");
  if (words.length === 1) {
    if (/^\p{N}+$/u.test(fromKey)) return false;
    return typeof isKnownWord === "function" && !isRealWord(fromKey, isKnownWord);
  }
  if (words.some((w) => STOPWORDS.has(w))) return false;
  return TERM_RE.test(to);
}

/** Alternatives of one entry that are rules: typed or approved, never pending. */
function entryRules(entry) {
  if (!entry || typeof entry.word !== "string" || !Array.isArray(entry.alternatives)) return [];
  const pending = new Set(Object.keys(entry.learnedCounts || {}).map(normalizePhrase));
  const out = [];
  for (const alt of entry.alternatives.slice(0, MAX_ALTERNATIVES_PER_WORD)) {
    if (typeof alt !== "string") continue;
    const from = alt.trim();
    const key = normalizePhrase(from);
    if (!key || key === normalizePhrase(entry.word) || pending.has(key)) continue;
    out.push({ from, to: entry.word, key });
  }
  return out;
}

/**
 * @param {Array<{word: string, alternatives?: string[], learnedCounts?: Object<string, number>}>} entries
 * @returns {{from: string, to: string}[]} Longest `from` first, one rule per mishearing
 */
function buildReplacementRules(entries) {
  const seen = new Set();
  const rules = [];
  for (const { from, to, key } of (Array.isArray(entries) ? entries : []).flatMap(entryRules)) {
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ from, to });
    if (rules.length >= MAX_RULES) break;
  }
  return rules.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Should Memory ask "Always change `from` to `to`?" now: the same fix learned
 * at least twice, not yet approved or declined, and safe to swap everywhere.
 *
 * @param {{isKnownWord?: (word: string) => boolean}} [options] - Word-list lookup for single words
 */
function swapOffer(entries, { from, to }, { isKnownWord } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const entry = list.find((e) => typeof e?.word === "string" && e.word.toLowerCase() === to.toLowerCase());
  const count = entry?.learnedCounts?.[from.toLowerCase()];
  if (!entry || count === undefined || count < MIN_LEARNED_FIXES) return false;
  if ((entry.declinedAlternatives || []).includes(normalizePhrase(from))) return false;
  const inverse = buildReplacementRules(list).some(
    (r) => normalizePhrase(r.from) === normalizePhrase(to) && normalizePhrase(r.to) === normalizePhrase(from)
  );
  return !inverse && isOfferSafe(from, to, isKnownWord);
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
  normalizePhrase,
  buildReplacementRules,
  swapOffer,
  compileReplacements,
  applyCompiledReplacements,
  applyReplacements,
  makeKnownWordChecker,
  splitReversals,
  planSessionLearning,
};
