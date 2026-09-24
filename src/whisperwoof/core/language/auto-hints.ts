/**
 * STT hints in Auto language mode (local whisper-server).
 *
 * An English hint prompt can hijack Whisper's decode of CJK speech into an
 * English translation (v1.15.3, on real recordings: "现在天气很好" came out
 * as "Now the time is good"). Whisper's language detection itself is not
 * affected by the prompt (whisper.cpp detects from the SOT token alone;
 * measured identical probabilities with and without a prompt). So hints are
 * sent in Auto mode, a hijack is recognised when Whisper detected a CJK
 * language but the text has no CJK characters, that decode is redone
 * without hints, and hints stay off until the next non-CJK dictation.
 */

const CJK_LANGUAGES = new Set([
  "chinese",
  "cantonese",
  "japanese",
  "korean",
  "zh",
  "yue",
  "ja",
  "ko",
]);

const CJK_TEXT_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

export function isCjkLanguage(language: string | null | undefined): boolean {
  return typeof language === "string" && CJK_LANGUAGES.has(language.toLowerCase());
}

export function isHintHijack(result: { language?: string | null; text?: string | null }): boolean {
  return isCjkLanguage(result.language) && !CJK_TEXT_RE.test(result.text ?? "");
}

export function nextAutoHintsSuppressed(
  suppressed: boolean,
  { language, hijacked }: { language?: string | null; hijacked: boolean }
): boolean {
  if (hijacked) return true;
  if (!language) return suppressed;
  return isCjkLanguage(language) ? suppressed : false;
}
