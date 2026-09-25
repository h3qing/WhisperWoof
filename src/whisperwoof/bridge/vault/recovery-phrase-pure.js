/**
 * Recovery phrase — 12 BIP39 English words for 128 bits of entropy.
 * The entropy is the seed of the vault's master key, so the words alone can
 * open the data on any Mac. Pure: no fs, no electron.
 */

const crypto = require("crypto");
const WORDS = require("./bip39-english");

const PHRASE_WORD_COUNT = 12;
const ENTROPY_BYTES = 16;
const CHECKSUM_BITS = 4; // entropy bits / 32

const INDEX = new Map(WORDS.map((w, i) => [w, i]));
// BIP39 words are unique in their first four letters, so "aban" means "abandon".
const PREFIX_INDEX = new Map(WORDS.map((w, i) => [w.slice(0, 4), i]));

function checksumBits(entropy) {
  const first = crypto.createHash("sha256").update(entropy).digest()[0];
  return first >> (8 - CHECKSUM_BITS);
}

function entropyToWords(entropy) {
  if (!Buffer.isBuffer(entropy) || entropy.length !== ENTROPY_BYTES) {
    throw new Error("Recovery phrase entropy must be 16 bytes");
  }
  const bits =
    [...entropy].map((b) => b.toString(2).padStart(8, "0")).join("") +
    checksumBits(entropy).toString(2).padStart(CHECKSUM_BITS, "0");
  return Array.from({ length: PHRASE_WORD_COUNT }, (_, i) => WORDS[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
}

function wordIndex(word) {
  if (INDEX.has(word)) return INDEX.get(word);
  if (word.length === 4 && PREFIX_INDEX.has(word)) return PREFIX_INDEX.get(word);
  return undefined;
}

function wordsToEntropy(words) {
  if (!Array.isArray(words) || words.length !== PHRASE_WORD_COUNT) {
    throw new Error(`A recovery phrase has ${PHRASE_WORD_COUNT} words`);
  }
  const unknown = words.map((w, i) => ({ w, n: i + 1 })).filter(({ w }) => wordIndex(w) === undefined);
  if (unknown.length > 0) {
    const list = unknown.map(({ w, n }) => `word ${n} ("${w}")`).join(", ");
    throw new Error(`Not a recovery phrase word: ${list}`);
  }
  const bits = words.map((w) => wordIndex(w).toString(2).padStart(11, "0")).join("");
  const entropy = Buffer.from(
    Array.from({ length: ENTROPY_BYTES }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2))
  );
  if (parseInt(bits.slice(ENTROPY_BYTES * 8), 2) !== checksumBits(entropy)) {
    throw new Error("These words don't form a valid recovery phrase (checksum). Check each word.");
  }
  return entropy;
}

/** What the user typed → entropy. Tolerates numbering, case, spacing and 4-letter prefixes. */
function parsePhrase(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/\d+[.)]/g, " ")
    .split(/[^a-z]+/)
    .filter(Boolean);
  return wordsToEntropy(words);
}

/** `count` distinct word positions to ask for back, in order. */
function pickConfirmIndexes(count = 3) {
  const picks = new Set();
  while (picks.size < count) picks.add(crypto.randomInt(PHRASE_WORD_COUNT));
  return [...picks].sort((a, b) => a - b);
}

module.exports = {
  PHRASE_WORD_COUNT,
  ENTROPY_BYTES,
  entropyToWords,
  wordsToEntropy,
  parsePhrase,
  pickConfirmIndexes,
};
