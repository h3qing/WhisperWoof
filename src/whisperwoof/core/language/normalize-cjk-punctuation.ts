// Han ideograph ranges we treat as "Chinese context" for punctuation.
const CJK = "\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff";
const HAS_CJK = new RegExp(`[${CJK}]`);

// Half-width -> full-width sentence punctuation.
const TO_FULL: Record<string, string> = {
  ",": "，",
  "?": "？",
  "!": "！",
  ":": "：",
  ";": "；",
};

// Full-width marks we add a trailing space after.
const FULL_MARKS = "。，？！：；";

/**
 * Normalize punctuation in Chinese dictation output:
 *  1. Convert half-width sentence punctuation that sits in Chinese context
 *     (immediately next to a Han character) to its full-width form, so a
 *     period is a real 句号 (。). Decimals (3.14), times (5:30), emails, and
 *     URLs are left alone because their punctuation is not Han-adjacent.
 *  2. Put a single half-width space after each full-width 。，？！：； when a
 *     real character follows (never before a space, a closing bracket/quote,
 *     or the end of the string).
 *
 * No-op for text with no Han characters, so English (and other non-CJK
 * output) is returned untouched. Idempotent: running it twice is a no-op on
 * the second pass.
 */
export function normalizeCjkPunctuation(text: string): string {
  if (typeof text !== "string" || !HAS_CJK.test(text)) return text;

  let out = text;

  // 1a. Period -> 。, guarded against dot-runs so "等等..." and decimals like
  // "3.14" are never mangled (a lone dot, Han on either side).
  out = out.replace(
    new RegExp(`(?<=[${CJK}])(?<!\\.)\\.(?!\\.)|(?<!\\.)\\.(?!\\.)(?=[${CJK}])`, "g"),
    "。"
  );

  // 1b. Remaining marks -> full-width when a Han char is immediately adjacent.
  for (const half of [",", "?", "!", ":", ";"]) {
    const esc = half.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<=[${CJK}])${esc}|${esc}(?=[${CJK}])`, "g"),
      TO_FULL[half]
    );
  }

  // 2. One half-width space after a full-width mark when a real char follows.
  // The negative classes keep runs (？！) tight and avoid trailing/closer spaces.
  out = out.replace(
    new RegExp(`([${FULL_MARKS}])(?=[^\\s${FULL_MARKS}」』）】》”’"'])`, "g"),
    "$1 "
  );

  return out;
}
