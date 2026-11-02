/**
 * Qwen3-ASR's answer (served by llama-server) as a transcript.
 *
 * The model answers "language Chinese<asr_text>…", once per 30 s chunk of a
 * long capture; llama-server passes the prefix through (ggml-org/llama.cpp
 * issue #26749). On silence it answers "language None<asr_text>" and
 * nothing else. The prefix goes, a broken "�" is repaired, and in a Chinese
 * or Cantonese answer spelled-out numbers become digits (chinese-itn.js;
 * never in Japanese, where 八百屋 is a greengrocer).
 *
 * Main-process module (CommonJS), next to lost-punctuation.js.
 */
const { repairLostPunctuation } = require("../language/lost-punctuation");
const { normalizeChineseNumbers } = require("../language/chinese-itn");

const ASR_PREFIX = /language\s+([A-Za-z]+)\s*<asr_text>/g;
// Han, kana, Hangul and full-width punctuation: no space between chunks.
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const CHINESE = new Set(["chinese", "cantonese"]);

/** Pieces of one transcript, joined with a space only between non-CJK text. */
function joinTranscripts(texts) {
  return texts
    .filter(Boolean)
    .reduce((joined, text) => (!joined ? text : CJK.test(joined.slice(-1)) || CJK.test(text[0]) ? joined + text : `${joined} ${text}`), "");
}

/** { text, language } — text "" when the model heard no speech. */
function parseQwenAsrOutput(raw) {
  const output = typeof raw === "string" ? raw : "";
  const languages = [...output.matchAll(ASR_PREFIX)].map((m) => m[1]).filter((l) => !/^none$/i.test(l));
  const joined = output.replace(ASR_PREFIX, (tag, _lang, offset, whole) => {
    const before = whole[offset - 1] ?? "";
    const after = whole[offset + tag.length] ?? "";
    return CJK.test(before) || CJK.test(after) ? "" : " ";
  });
  const text = repairLostPunctuation(joined.replace(/\s+/g, " ").trim());
  const language = languages[0]?.toLowerCase() ?? null;
  return { text: CHINESE.has(language) ? normalizeChineseNumbers(text) : text, language };
}

module.exports = { parseQwenAsrOutput, joinTranscripts };
