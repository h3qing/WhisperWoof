/**
 * An accidental press with nobody talking must type nothing. What Whisper
 * says for such a capture is all here; real dictation around the same words
 * must still go through.
 */
import { describe, it, expect } from "vitest";
import { isNonSpeechTranscript } from "./non-speech-transcript";

describe("isNonSpeechTranscript", () => {
  it("drops text with no words in it at all", () => {
    for (const text of ["...", "…", "。", "♪♪", " - ", "�", ""]) {
      expect(isNonSpeechTranscript(text, 5)).toBe(true);
    }
  });

  it("drops tags standing in for silence, music or noise", () => {
    for (const text of ["[BLANK_AUDIO]", "[ Silence ]", "(音乐)", "（笑）", "【掌声】", "*music*", "[Music] ♪"]) {
      expect(isNonSpeechTranscript(text, 3)).toBe(true);
    }
  });

  it("always drops subtitle credit lines, however much audio there was", () => {
    expect(isNonSpeechTranscript("字幕由Amara.org社区提供", 80)).toBe(true);
    expect(isNonSpeechTranscript("请不吝点赞 订阅 转发 打赏支持明镜与点点栏目", 80)).toBe(true);
    expect(isNonSpeechTranscript("Subtitles by the Amara.org community", null)).toBe(true);
  });

  it("drops video outros when the capture barely had any voice", () => {
    expect(isNonSpeechTranscript("谢谢观看!", 3)).toBe(true);
    expect(isNonSpeechTranscript("Thanks for watching! Thanks for watching!", 6)).toBe(true);
    expect(isNonSpeechTranscript("you", 2)).toBe(true);
    expect(isNonSpeechTranscript("ご視聴ありがとうございました", 4)).toBe(true);
  });

  it("keeps an outro someone clearly said, or when the voice couldn't be measured", () => {
    expect(isNonSpeechTranscript("谢谢观看", 30)).toBe(false);
    expect(isNonSpeechTranscript("Thanks for watching!", null)).toBe(false);
  });

  it("never drops real dictation that mentions the same words", () => {
    expect(isNonSpeechTranscript("Thank you.", 5)).toBe(false);
    expect(isNonSpeechTranscript("谢谢", 3)).toBe(false);
    expect(isNonSpeechTranscript("字幕制作要在周五前完成", 10)).toBe(false);
    expect(isNonSpeechTranscript("Thank you for watching the kids today", 12)).toBe(false);
    expect(isNonSpeechTranscript("see you", 3)).toBe(false);
    expect(isNonSpeechTranscript("明天(周五)开会", 8)).toBe(false);
  });

  it("ignores anything that isn't a string", () => {
    expect(isNonSpeechTranscript(undefined, 0)).toBe(false);
  });
});
