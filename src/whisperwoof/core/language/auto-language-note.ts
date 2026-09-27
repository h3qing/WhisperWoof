/**
 * Local Whisper in Auto language mode hears ONE language per recording.
 *
 * whisper.cpp detects the language once, from the first 30 seconds of audio,
 * and decodes the whole recording in it. A few words of another language
 * survive (the eval/dictation-bench code-switch cases), but when someone
 * starts in Chinese and then says a long stretch of English, the detection
 * says English, and Whisper told "English" translates the Chinese instead of
 * transcribing it (bench finding 1). Uploaded files are decoded the same way.
 *
 * A real fix means detecting the language per phrase and decoding again,
 * several extra model passes on every dictation, so the app tells people
 * instead: once, after their first dictation Whisper heard as Chinese,
 * Japanese or Korean (the people likely to mix), and next to the settings
 * that choose this path.
 */

import { isCjkLanguage } from "./auto-hints";

export const MIXED_LANGUAGE_TIP_KEY = "whisperwoof-mixed-language-tip-shown";

/**
 * The note applies to local Whisper when no language is pinned. Parakeet has
 * its own language handling, and cloud engines aren't whisper.cpp.
 */
export function autoLanguageNoteApplies({
  useLocalWhisper,
  provider,
  language,
}: {
  useLocalWhisper: boolean;
  provider: string | null | undefined;
  language?: string | null;
}): boolean {
  return useLocalWhisper && provider !== "nvidia" && (!language || language === "auto");
}

/** Show the one-time tip after the first dictation Whisper detected as CJK. */
export function shouldShowMixedLanguageTip({
  detectedLanguage,
  alreadyShown,
}: {
  detectedLanguage?: string | null;
  alreadyShown: boolean;
}): boolean {
  return !alreadyShown && isCjkLanguage(detectedLanguage);
}
