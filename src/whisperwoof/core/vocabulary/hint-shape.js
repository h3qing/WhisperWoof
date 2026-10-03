/**
 * Memory and Dictionary words are terms, never clauses.
 *
 * Auto-learn splits a pasted transcript on spaces, and Chinese has none: a
 * whole clause between two English words was one "word", and fixing it
 * stored the clause. As STT hints those clauses made Whisper write English
 * speech in Chinese ("Please check the latest version" came out as
 * "请订阅…"). The clauses learned that way ran 11-15 characters and all had a
 * particle or pronoun (的 了 吧 我 这 …); names and terms rarely do, even long
 * ones (国家发展和改革委员会). Only Chinese characters count: Japanese
 * katakana terms and spaced Korean phrases are left alone.
 *
 * Main-process module (CommonJS): correctionLearner.js and
 * pack-manager-pure.js both use it.
 */

const HAN = /[㐀-䶿一-鿿豈-﫿]/gu;
const PARTICLE = /[的了吧吗呢我你他她这那是在都也就还]/u;
const MIN_CLAUSE_HAN = 5;
const MAX_TERM_HAN = 12;

function isChineseClause(text) {
  if (typeof text !== "string") return false;
  const han = (text.match(HAN) || []).length;
  if (han < MIN_CLAUSE_HAN) return false;
  return han > MAX_TERM_HAN || PARTICLE.test(text);
}

module.exports = { isChineseClause };
