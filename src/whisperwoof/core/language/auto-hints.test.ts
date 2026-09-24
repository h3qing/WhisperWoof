/**
 * Auto language mode + STT hints. An English hint prompt can hijack
 * Whisper's decode of Chinese speech into an English translation (v1.15.3:
 * "现在天气很好" came out as "Now the time is good"), while Whisper's own
 * language detection is unaffected by the prompt. So hints are sent in Auto
 * mode, a hijack is recognised from the detected language, and hints stay
 * off until an English dictation.
 */
import { describe, it, expect } from "vitest";
import { isCjkLanguage, isHintHijack, nextAutoHintsSuppressed, shouldSendHints } from "./auto-hints";

describe("shouldSendHints", () => {
  it("always sends with a pinned language", () => {
    expect(shouldSendHints({ hasPrompt: true, language: "zh", suppressed: true })).toBe(true);
  });

  it("sends in Auto mode unless hints were suppressed", () => {
    expect(shouldSendHints({ hasPrompt: true, language: null, suppressed: false })).toBe(true);
    expect(shouldSendHints({ hasPrompt: true, language: null, suppressed: true })).toBe(false);
  });

  it("never sends an empty prompt", () => {
    expect(shouldSendHints({ hasPrompt: false, language: "en", suppressed: false })).toBe(false);
  });
});

describe("isCjkLanguage", () => {
  it("recognises whisper-server names and ISO codes", () => {
    for (const lang of ["chinese", "Chinese", "cantonese", "japanese", "korean", "zh", "yue", "ja", "ko"]) {
      expect(isCjkLanguage(lang)).toBe(true);
    }
    for (const lang of ["english", "en", "spanish", "", null, undefined]) {
      expect(isCjkLanguage(lang)).toBe(false);
    }
  });
});

describe("isHintHijack", () => {
  it("flags Chinese speech that came out with no Chinese characters", () => {
    expect(isHintHijack({ language: "chinese", text: "Now the time is good" })).toBe(true);
  });

  it("accepts Chinese output, including mixed Chinese and English", () => {
    expect(isHintHijack({ language: "chinese", text: "现在天气很好" })).toBe(false);
    expect(isHintHijack({ language: "chinese", text: "把项目 deploy 到 Supabase" })).toBe(false);
  });

  it("accepts Japanese and Korean scripts", () => {
    expect(isHintHijack({ language: "japanese", text: "こんにちは" })).toBe(false);
    expect(isHintHijack({ language: "korean", text: "안녕하세요" })).toBe(false);
  });

  it("never flags non-CJK languages or a missing language", () => {
    expect(isHintHijack({ language: "english", text: "hello" })).toBe(false);
    expect(isHintHijack({ language: undefined, text: "hello" })).toBe(false);
  });
});

describe("nextAutoHintsSuppressed", () => {
  it("suppresses hints after a hijack", () => {
    expect(nextAutoHintsSuppressed(false, { language: "chinese", hijacked: true })).toBe(true);
  });

  it("re-enables hints after an English (or other non-CJK) dictation", () => {
    expect(nextAutoHintsSuppressed(true, { language: "english", hijacked: false })).toBe(false);
  });

  it("keeps the current state for clean CJK dictations or an unknown language", () => {
    expect(nextAutoHintsSuppressed(true, { language: "chinese", hijacked: false })).toBe(true);
    expect(nextAutoHintsSuppressed(false, { language: "chinese", hijacked: false })).toBe(false);
    expect(nextAutoHintsSuppressed(true, { language: undefined, hijacked: false })).toBe(true);
  });
});
