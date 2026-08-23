import { Converter } from "opencc-js/t2cn";

/**
 * Chinese script normalization — renderer implementation.
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
 *
 * The Electron main process has its own copy of this logic in
 * `bridge/chinese-script.js` — it CANNOT be shared: Vite only applies its
 * CommonJS transform to node_modules, so a project-local CJS module imported
 * into the renderer graph reaches the production bundle with a bare
 * `module.exports` and throws at chunk load. The two copies are held
 * together by the parity suite in `chinese-script-parity.test.ts`; change
 * both files together.
 */

/** CJK Unified Ideographs + Extension A. Matches Han characters only. */
const HAN = /[一-鿿㐀-䶿]/;

export type ChineseScript = "simplified" | "off";

// Converter() builds its lookup trie eagerly, so construct it at most once
// per process, on first Chinese transcript.
let converter: ((text: string) => string) | undefined;

function getConverter(): (text: string) => string {
  if (converter === undefined) {
    // `from: "t"` is generic Traditional, NOT `"tw"` — the Taiwan variant
    // rewrites 么 -> 幺 and corrupts correctly-Simplified input.
    converter = Converter({ from: "t", to: "cn" });
  }
  return converter;
}

/**
 * Convert Traditional Han characters in `text` to Simplified.
 *
 * Returns `text` unchanged when the target is "off" or when the text contains
 * no Han characters.
 */
export function normalizeChineseScript(
  text: string,
  target: ChineseScript = "simplified"
): string {
  if (target === "off") return text;
  if (typeof text !== "string" || !text) return text;
  if (!HAN.test(text)) return text;

  try {
    return getConverter()(text);
  } catch {
    // A conversion failure on one transcript must not lose the transcript.
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
 */
export function scriptForLanguage(language: string | null | undefined): ChineseScript {
  const normalized = String(language ?? "").toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant") {
    return "off";
  }
  return "simplified";
}
