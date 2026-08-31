/**
 * Deterministic guard on LLM cleanup output — the last line of defense
 * against a polish model pasting its own deliberation into the user's text.
 *
 * Observed in the wild (Qwen3.5 2B): raw "…如果架构合适的话…" came back as the
 * cleaned sentence PLUS 300 characters of the model discussing whether 架构
 * was a typo ("注：原文中"架构"为误写… 修正后：…"). `<think>` stripping and
 * `enable_thinking: false` already exist upstream of this — but inline
 * meta-commentary is plain text and no tag strip can catch it.
 *
 * Four independent, deterministic checks, all judged AGAINST THE RAW INPUT so
 * legitimately dictated words can never trip them:
 *
 *  1. Growth: cleanup removes fillers and fixes punctuation — it never
 *     multiplies the text. Output longer than GROWTH_RATIO x input (plus a
 *     fixed slack for punctuation/number expansion) is not a cleanup.
 *  2. Language flip: a mostly-Chinese input can never come back with almost
 *     no Han characters (or the reverse) — that is a translation, also
 *     observed in production ("Pizzo,你知不知道…" -> pure English).
 *  3. Emote: a reply that is just "*punch*" is the model roleplaying, unless
 *     the user dictated the asterisks (literally or as 星号/asterisk).
 *  4. Meta markers: a short, high-precision list of phrases a cleanup model
 *     uses to talk ABOUT the text (注：, 修正后：, "Here is the cleaned"…).
 *     Only counted when the RAW text does not itself contain the marker.
 *
 * On rejection the caller pastes the raw transcript: what the user actually
 * said always beats what a model wanted to say about it.
 */

const GROWTH_RATIO = 2.0;
const GROWTH_SLACK_CHARS = 60;

// High-precision only: each of these is a phrase used to discuss a text, not
// to write one. Anything ambiguous stays off this list — the growth check
// catches verbose leaks anyway.
const META_MARKERS = [
  // zh deliberation
  "注：",
  "注意：",
  "修正后：",
  "修正为",
  "原文中",
  "清理后的文本",
  "以下是清理",
  "处理后的文本",
  // en deliberation
  "here is the cleaned",
  "here's the cleaned",
  "cleaned-up version",
  "cleaned up version",
  "corrected version:",
  "i corrected",
  "i have corrected",
  "the original text",
  "note:",
];

export interface PolishGuardResult {
  accepted: boolean;
  /** The text to use: polished when accepted, raw when rejected. */
  text: string;
  reason?: "growth" | "meta-marker" | "language-flip" | "emote";
  marker?: string;
}

const HAN_RE = /[一-鿿㐀-䶿]/g;
const LATIN_RE = /[a-zA-Z]/g;
// Spoken punctuation words are meta, not content: "星号 punch 星号" legitimately
// becomes *punch*, which would otherwise read as a Han-ratio collapse.
const SPOKEN_PUNCT_RE = /句号|逗号|问号|感叹号|冒号|分号|顿号|换行|新段落|另起一段|星号|引号|括号/g;
// A reply that is just "*punch*" — an LLM roleplay emote, not a cleanup.
const EMOTE_RE = /^\s*\*[^*\n]{1,40}\*\s*$/;

function letterCounts(text: string): { han: number; latin: number } {
  const content = text.replace(SPOKEN_PUNCT_RE, "");
  return {
    han: (content.match(HAN_RE) || []).length,
    latin: (content.match(LATIN_RE) || []).length,
  };
}

/**
 * Whole-sentence translation detector. Observed with Qwen3.5 2B: raw
 * "Pizzo,你知不知道你的手机可不可以用eSIM?" came back entirely in English —
 * shorter than the input and free of meta-markers, so the other checks pass
 * it. But a cleanup can never collapse the input's language composition:
 * when the raw text is substantially Chinese and the output has almost no
 * Han characters left (or the reverse), the model translated. Ratios are
 * over language letters only, so punctuation and digit conversion
 * ("三百块" -> "300元") cannot skew them.
 */
function isLanguageFlip(raw: string, polished: string): boolean {
  const r = letterCounts(raw);
  const p = letterCounts(polished);
  const rTotal = r.han + r.latin;
  const pTotal = p.han + p.latin;
  if (rTotal < 6 || pTotal < 2) return false; // too little signal to judge

  const rHanRatio = r.han / rTotal;
  const pHanRatio = p.han / pTotal;

  // zh -> en: substantial Chinese in, almost none out.
  if (rHanRatio >= 0.3 && pHanRatio <= rHanRatio * 0.25) return true;
  // en -> zh: substantial Latin in, almost none out.
  const rLatinRatio = 1 - rHanRatio;
  const pLatinRatio = 1 - pHanRatio;
  if (rLatinRatio >= 0.5 && pLatinRatio <= rLatinRatio * 0.25) return true;

  return false;
}

export function guardPolishedOutput(raw: string, polished: string): PolishGuardResult {
  const rawText = typeof raw === "string" ? raw : "";
  const polishedText = typeof polished === "string" ? polished : "";

  if (!polishedText.trim()) {
    // Empty polish is handled by callers' existing `text || rawText` fallbacks.
    return { accepted: true, text: polishedText };
  }

  if (polishedText.length > rawText.length * GROWTH_RATIO + GROWTH_SLACK_CHARS) {
    return { accepted: false, text: rawText, reason: "growth" };
  }

  if (isLanguageFlip(rawText, polishedText)) {
    return { accepted: false, text: rawText, reason: "language-flip" };
  }

  // "*punch*" out of thin air is an LLM roleplay emote — unless the user
  // dictated the asterisks themselves (literally, or as spoken punctuation:
  // "星号 punch 星号" / "asterisk punch asterisk" legitimately becomes *punch*).
  const dictatedAsterisk = rawText.includes("*") || /星号|asterisk/i.test(rawText);
  if (EMOTE_RE.test(polishedText) && !dictatedAsterisk) {
    return { accepted: false, text: rawText, reason: "emote" };
  }

  const polishedLower = polishedText.toLowerCase();
  const rawLower = rawText.toLowerCase();
  for (const marker of META_MARKERS) {
    if (polishedLower.includes(marker) && !rawLower.includes(marker)) {
      return { accepted: false, text: rawText, reason: "meta-marker", marker };
    }
  }

  return { accepted: true, text: polishedText };
}
