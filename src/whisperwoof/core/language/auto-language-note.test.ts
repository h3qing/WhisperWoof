/**
 * whisper.cpp picks one language per recording from its first 30 seconds, so
 * "Chinese, then a long stretch of English" comes back all English (the
 * Chinese translated). The app doesn't re-decode per phrase; it tells people,
 * once after their first CJK dictation, and in Settings / Upload audio.
 */
import { describe, it, expect } from "vitest";
import { autoLanguageNoteApplies, shouldShowMixedLanguageTip } from "./auto-language-note";

describe("autoLanguageNoteApplies", () => {
  it("applies to local Whisper in Auto mode", () => {
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: true, provider: "whisper", language: "auto" })
    ).toBe(true);
    expect(autoLanguageNoteApplies({ useLocalWhisper: true, provider: "whisper" })).toBe(true);
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: true, provider: undefined, language: null })
    ).toBe(true);
  });

  it("does not apply when a language is pinned", () => {
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: true, provider: "whisper", language: "zh-CN" })
    ).toBe(false);
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: true, provider: "whisper", language: "en" })
    ).toBe(false);
  });

  it("does not apply to Parakeet or cloud transcription", () => {
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: true, provider: "nvidia", language: "auto" })
    ).toBe(false);
    expect(
      autoLanguageNoteApplies({ useLocalWhisper: false, provider: "whisper", language: "auto" })
    ).toBe(false);
  });
});

describe("shouldShowMixedLanguageTip", () => {
  it("shows once, after Whisper detects Chinese, Japanese or Korean", () => {
    for (const detectedLanguage of ["chinese", "japanese", "korean", "cantonese"]) {
      expect(shouldShowMixedLanguageTip({ detectedLanguage, alreadyShown: false })).toBe(true);
      expect(shouldShowMixedLanguageTip({ detectedLanguage, alreadyShown: true })).toBe(false);
    }
  });

  it("stays quiet for English-only speakers and when the language is unknown", () => {
    expect(shouldShowMixedLanguageTip({ detectedLanguage: "english", alreadyShown: false })).toBe(
      false
    );
    expect(shouldShowMixedLanguageTip({ detectedLanguage: undefined, alreadyShown: false })).toBe(
      false
    );
    expect(shouldShowMixedLanguageTip({ detectedLanguage: null, alreadyShown: false })).toBe(false);
  });
});
