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
 * Two independent, deterministic checks, both judged AGAINST THE RAW INPUT so
 * legitimately dictated words can never trip them:
 *
 *  1. Growth: cleanup removes fillers and fixes punctuation — it never
 *     multiplies the text. Output longer than GROWTH_RATIO x input (plus a
 *     fixed slack for punctuation/number expansion) is not a cleanup.
 *  2. Meta markers: a short, high-precision list of phrases a cleanup model
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
  reason?: "growth" | "meta-marker";
  marker?: string;
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

  const polishedLower = polishedText.toLowerCase();
  const rawLower = rawText.toLowerCase();
  for (const marker of META_MARKERS) {
    if (polishedLower.includes(marker) && !rawLower.includes(marker)) {
      return { accepted: false, text: rawText, reason: "meta-marker", marker };
    }
  }

  return { accepted: true, text: polishedText };
}
