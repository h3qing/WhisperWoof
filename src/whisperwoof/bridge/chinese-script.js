/**
 * Chinese script normalization — shared implementation.
 *
 * Lives here in CommonJS because both sides need it: the renderer's dictation
 * path (via core/language/normalize-chinese-script.ts, which re-exports this
 * with types) and the Electron main process's retry-transcription handler.
 * One implementation so the two can never drift.
 *
 * Whisper's auto language detection picks a *language* (`zh`), not a *script*,
 * and emits Traditional characters on Simplified speech. Measured on real
 * human audio in eval/dictation-bench:
 *
 *   whisper-small:auto  ->  開放時間早上9點至下午5點     (Traditional)
 *   whisper-turbo:auto  ->  开放时间早上9点至下午5点     (Simplified)
 *
 * `getBaseLanguageCode` (utils/languageSupport.ts) collapses `zh-CN`/`zh-TW`
 * to `zh` before the request is built, so the only signal that could settle
 * this never reaches whisper.cpp. A larger model makes the leak rarer but does
 * not remove it, so we settle the script deterministically on the way out.
 *
 * Only Traditional -> Simplified ships: it is the direction that fixes a
 * measured defect, and `opencc-js/t2cn` costs ~49KB gzipped against ~480KB for
 * the bidirectional bundle. Speakers who want Traditional output get "off" and
 * keep whatever whisper produced.
 */

const { Converter } = require("opencc-js/t2cn");

/** CJK Unified Ideographs + Extension A. Matches Han characters only. */
const HAN = /[一-鿿㐀-䶿]/;

// opencc-js builds its lookup tables on Converter() construction, so build it
// at most once per process and reuse it.
let converter;

function getConverter() {
  if (converter !== undefined) return converter;
  try {
    converter = Converter({ from: "tw", to: "cn" });
  } catch {
    // Conversion is a nicety, never a reason to lose a transcript.
    converter = null;
  }
  return converter;
}

/**
 * Convert Traditional Han characters in `text` to Simplified.
 *
 * Returns `text` unchanged when the target is "off", when the text contains no
 * Han characters, or when the converter is unavailable.
 *
 * @param {string} text
 * @param {"simplified"|"off"} [target]
 * @returns {string}
 */
function normalizeChineseScript(text, target = "simplified") {
  if (target === "off") return text;
  if (typeof text !== "string" || !text) return text;
  if (!HAN.test(text)) return text;

  const convert = getConverter();
  if (!convert) return text;

  try {
    return convert(text);
  } catch {
    return text;
  }
}

/**
 * Map a dictation-language preference (`auto`, `zh-CN`, `zh-TW`, `en`, …) to
 * the script its speaker expects.
 *
 * `zh-TW`/`zh-HK` speakers want Traditional, so their output is left alone.
 * Every other value — including `auto`, which is the default and what a zh/en
 * bilingual user should be on — normalizes to Simplified. Non-Chinese
 * preferences resolve to "simplified" too, but that is a no-op for their
 * Han-free output.
 *
 * @param {string|null|undefined} language
 * @returns {"simplified"|"off"}
 */
function scriptForLanguage(language) {
  const normalized = String(language ?? "").toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant") {
    return "off";
  }
  return "simplified";
}

module.exports = { normalizeChineseScript, scriptForLanguage };
