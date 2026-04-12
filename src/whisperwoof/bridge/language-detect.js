/**
 * Language Detection — Auto-detect transcript language for multi-language support
 *
 * Whisper can detect the spoken language, but the result isn't always passed
 * through to the polish step. This module:
 * 1. Detects language from text using character/word heuristics (fast, no API)
 * 2. Adapts the polish prompt to work in the detected language
 * 3. Tags entries with the detected language for analytics
 *
 * Supports: English, Spanish, French, German, Portuguese, Italian, Dutch,
 * Japanese, Chinese, Korean, Russian, Arabic, Hindi, Turkish, Polish,
 * Vietnamese, Thai, Indonesian, Swedish, Danish, Norwegian, Finnish
 */

const debugLogger = require("../../helpers/debugLogger");

// --- Character-range heuristics ---

// NOTE: /g is required. Without it, String.match returns only the first hit,
// so matches.length === 1 and ratio = 1/N never clears the 0.15 threshold for
// any real-length string, which silently breaks script-based detection.
const SCRIPT_PATTERNS = [
  { lang: "ja", pattern: /[\u3040-\u309F\u30A0-\u30FF]/g, name: "Japanese" },
  { lang: "ko", pattern: /[\uAC00-\uD7AF\u1100-\u11FF]/g, name: "Korean" },
  { lang: "zh", pattern: /[\u4E00-\u9FFF\u3400-\u4DBF]/g, name: "Chinese" },
  { lang: "ar", pattern: /[\u0600-\u06FF\u0750-\u077F]/g, name: "Arabic" },
  { lang: "hi", pattern: /[\u0900-\u097F]/g, name: "Hindi" },
  { lang: "th", pattern: /[\u0E00-\u0E7F]/g, name: "Thai" },
  { lang: "ru", pattern: /[\u0400-\u04FF]/g, name: "Russian" },
];

// --- Common word heuristics for Latin-script languages ---

const WORD_PATTERNS = [
  { lang: "es", words: ["que", "por", "las", "los", "una", "del", "con", "para", "como", "esta", "pero", "más", "tiene", "también", "puede"], name: "Spanish" },
  { lang: "fr", words: ["les", "des", "une", "que", "est", "dans", "pour", "pas", "qui", "sur", "avec", "sont", "mais", "cette", "tout"], name: "French" },
  { lang: "de", words: ["der", "die", "das", "und", "ist", "ein", "eine", "für", "mit", "auf", "den", "nicht", "sich", "auch", "werden"], name: "German" },
  { lang: "pt", words: ["que", "para", "uma", "com", "por", "não", "mais", "está", "tem", "são", "mas", "como", "muito", "também", "pode"], name: "Portuguese" },
  { lang: "it", words: ["che", "per", "una", "con", "sono", "non", "come", "questo", "anche", "della", "più", "alla", "nella", "essere", "fatto"], name: "Italian" },
  { lang: "nl", words: ["het", "een", "van", "dat", "met", "voor", "niet", "zijn", "ook", "maar", "wel", "nog", "aan", "bij", "wordt"], name: "Dutch" },
  { lang: "tr", words: ["bir", "için", "ile", "olan", "gibi", "daha", "çok", "kadar", "sonra", "ancak"], name: "Turkish" },
  { lang: "pl", words: ["jest", "nie", "się", "tak", "jak", "ale", "już", "jego", "tym", "tylko"], name: "Polish" },
  { lang: "vi", words: ["của", "một", "cho", "các", "không", "được", "này", "trong", "là", "có"], name: "Vietnamese" },
  { lang: "id", words: ["yang", "dan", "ini", "untuk", "dengan", "dari", "tidak", "ada", "akan", "juga"], name: "Indonesian" },
  { lang: "sv", words: ["och", "att", "det", "som", "för", "med", "inte", "den", "har", "kan"], name: "Swedish" },
  { lang: "da", words: ["og", "det", "som", "til", "med", "ikke", "den", "har", "kan", "fra"], name: "Danish" },
  { lang: "no", words: ["og", "det", "som", "til", "med", "ikke", "den", "har", "kan", "fra", "denne"], name: "Norwegian" },
  { lang: "fi", words: ["on", "oli", "tai", "kun", "niin", "mutta", "vain", "myös", "joka", "kuin"], name: "Finnish" },
];

// Language name lookup
const LANGUAGE_NAMES = Object.fromEntries([
  ...SCRIPT_PATTERNS.map((p) => [p.lang, p.name]),
  ...WORD_PATTERNS.map((p) => [p.lang, p.name]),
  ["en", "English"],
]);

/**
 * Detect the language of a text string.
 * Returns { lang, name, confidence } or { lang: "en", name: "English", confidence: "default" }
 *
 * Detection priority:
 * 1. Script-based (CJK, Cyrillic, Arabic, etc.) — high confidence
 * 2. Word-frequency heuristic for Latin-script languages — medium confidence
 * 3. Default to English — low confidence
 */
function detectLanguage(text) {
  if (!text || text.trim().length < 5) {
    return { lang: "en", name: "English", confidence: "default" };
  }

  const trimmed = text.trim();

  // 1. Script-based detection (high confidence for non-Latin scripts)
  for (const { lang, pattern, name } of SCRIPT_PATTERNS) {
    const matches = (trimmed.match(pattern) || []).length;
    const ratio = matches / trimmed.length;
    if (ratio > 0.15) {
      return { lang, name, confidence: "high" };
    }
  }

  // 2. Word-frequency heuristic for Latin-script languages
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length < 3) {
    return { lang: "en", name: "English", confidence: "default" };
  }

  const wordSet = new Set(words);
  let bestLang = null;
  let bestScore = 0;

  for (const { lang, words: markers, name } of WORD_PATTERNS) {
    const matchCount = markers.filter((m) => wordSet.has(m)).length;
    const score = matchCount / markers.length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = { lang, name };
    }
  }

  // Need at least 20% marker word match to be confident
  if (bestLang && bestScore >= 0.2) {
    return { ...bestLang, confidence: bestScore >= 0.4 ? "high" : "medium" };
  }

  return { lang: "en", name: "English", confidence: "default" };
}

/**
 * Build a language-aware polish prompt suffix.
 * Appended to the system prompt when the detected language isn't English.
 */
function getLanguagePolishSuffix(lang) {
  if (!lang || lang === "en") return "";

  const name = LANGUAGE_NAMES[lang] || lang;
  return `\n\nIMPORTANT: The text is in ${name}. Polish it in ${name}. Do NOT translate to English. Keep the same language.`;
}

/**
 * Get list of supported languages (for settings UI).
 */
function getSupportedLanguages() {
  return Object.entries(LANGUAGE_NAMES).map(([code, name]) => ({ code, name }));
}

module.exports = {
  detectLanguage,
  getLanguagePolishSuffix,
  getSupportedLanguages,
  LANGUAGE_NAMES,
};
