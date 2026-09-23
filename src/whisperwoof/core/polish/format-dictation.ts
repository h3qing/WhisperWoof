/**
 * Deterministic formatting for dictation output, applied after the LLM polish
 * (and instead of it for short utterances). Pure string transforms: no model,
 * no latency, same result every time.
 */

const HAN = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
const HAS_HAN = new RegExp(`[${HAN}]`);
const ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
// 第X counts as a list marker only when a separator follows it, so 第一次 /
// 第二天 (ordinals used as words) never match.
const MARKER = new RegExp(`第([${ORDINALS.join("")}])\\s*[，,、：:]\\s*`, "g");
const TRIM_ITEM = /^[\s，,、；;。.]+|[\s，,、；;。.]+$/g;

/** "…？ 第一， A； 第二， B。" → "…？\n1. A\n2. B" (needs 第一, 第二, … in order). */
export function formatSpokenEnumeration(text: string): string {
  const markers = [...text.matchAll(MARKER)];
  if (markers.length < 2) return text;
  const inOrder = markers.every((m, i) => m[1] === ORDINALS[i]);
  if (!inOrder) return text;

  const items = markers.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    return text.slice(start, end).replace(TRIM_ITEM, "");
  });
  if (items.some((item) => !item)) return text;

  const lead = text.slice(0, markers[0].index).trim();
  const list = items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return lead ? `${lead}\n${list}` : list;
}

const HAS_PUNCTUATION = /[，。？！、；：,.?!;:]/;
// Sentence-final particles, or an A-not-A question anywhere ("你看是不是这样").
const QUESTION = /(吗|么|呢)$|是不是|有没有|能不能|可不可以|要不要|对不对|好不好/;
const CJK_GAP = new RegExp(`(?<=[${HAN}])\\s+(?=[${HAN}])`, "g");

/** Short Chinese transcripts skip the LLM; give them commas at pauses and an end mark. */
export function punctuateShortCjk(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !HAS_HAN.test(trimmed) || HAS_PUNCTUATION.test(trimmed)) return text;
  const withCommas = trimmed.replace(CJK_GAP, "，");
  return `${withCommas}${QUESTION.test(withCommas) ? "？" : "。"}`;
}
