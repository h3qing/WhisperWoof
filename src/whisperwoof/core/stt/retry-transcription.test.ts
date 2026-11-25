/**
 * Tests for retry-transcription decision logic.
 *
 * Imports the real bridge module the IPC handler uses, so drift between
 * tested and production behaviour is impossible.
 */
import { describe, it, expect } from "vitest";
import * as retry from "../../bridge/retry-transcription-pure.js";

const { resolveRetryWhisperModel, resolveRetryProvider, resolveRetryLanguage } = retry;

describe("resolveRetryWhisperModel", () => {
  const downloaded = ["small", "turbo", "base"];

  it("uses the requested model when it is downloaded", () => {
    expect(resolveRetryWhisperModel(downloaded, "small")).toBe("small");
    expect(resolveRetryWhisperModel(downloaded, "turbo")).toBe("turbo");
  });

  it("falls back to the best downloaded model rather than refusing to retry", () => {
    expect(resolveRetryWhisperModel(["base", "small"], "turbo")).toBe("small");
    expect(resolveRetryWhisperModel(["tiny"], "large")).toBe("tiny");
  });

  it("returns null only when nothing is downloaded", () => {
    expect(resolveRetryWhisperModel([], "turbo")).toBeNull();
    expect(resolveRetryWhisperModel(["not-a-model"], "turbo")).toBeNull();
    expect(resolveRetryWhisperModel(undefined, "turbo")).toBeNull();
  });

  it("still picks a model when no id is requested", () => {
    expect(resolveRetryWhisperModel(downloaded)).toBe("turbo");
  });

  it("returns a registry id, never a filename — transcribeLocalWhisper validates ids", () => {
    expect(resolveRetryWhisperModel(["ggml-small.bin", "small"], "small")).toBe("small");
    expect(resolveRetryWhisperModel(["ggml-small.bin"], "small")).toBeNull();
  });
});

describe("resolveRetryProvider", () => {
  it("uses Qwen3-ASR for a Qwen3-ASR user once its model is on disk", () => {
    const base = { provider: "qwen", parakeetAvailable: true, whisperAvailable: true };
    expect(resolveRetryProvider({ ...base, language: "zh-CN", qwenAvailable: true })).toBe("qwen");
    expect(resolveRetryProvider({ ...base, language: "auto", qwenAvailable: false })).toBe("whisper");
    // Auto (the default) is no language to check: Qwen3-ASR detects it.
    expect(
      resolveRetryProvider({ ...base, language: "auto", qwenAvailable: true, qwenServesLanguage: (l: string) => l === "zh" })
    ).toBe("qwen");
    expect(
      resolveRetryProvider({ ...base, language: "uk", qwenAvailable: true, qwenServesLanguage: () => false })
    ).toBe("whisper");
  });

  it("routes Chinese away from Parakeet, which has no CJK coverage", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "zh-CN",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("whisper");
  });

  it("keeps Parakeet for languages it actually covers", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "en",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("parakeet");
  });

  it("honours a Whisper user even when Parakeet is installed", () => {
    // The old handler tried Parakeet first whenever its server was up,
    // ignoring the configured engine entirely.
    expect(
      resolveRetryProvider({
        provider: "whisper",
        language: "auto",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("whisper");
  });

  it("keeps a real Parakeet model on auto (it lists its languages; auto isn't one)", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "auto",
        parakeetModel: "sense-voice-zh-en",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("parakeet");
  });

  it("treats auto as safe for Parakeet only when Whisper is unavailable", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "auto",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("parakeet");
  });

  it("does not fall back to Parakeet for a language it cannot serve", () => {
    // Whisper down + Chinese + only Parakeet installed: running Parakeet
    // would return an empty transcript. Naming whisper lets the handler
    // surface "Whisper server binary not found", which is the real problem.
    expect(
      resolveRetryProvider({
        provider: "whisper",
        language: "zh-CN",
        parakeetAvailable: true,
        whisperAvailable: false,
      })
    ).toBe("whisper");
  });

  it("does fall back to Parakeet when it can serve the language", () => {
    expect(
      resolveRetryProvider({
        provider: "whisper",
        language: "en",
        parakeetAvailable: true,
        whisperAvailable: false,
      })
    ).toBe("parakeet");
  });

  it("falls back to the other engine when the preferred one is down", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "en",
        parakeetAvailable: false,
        whisperAvailable: true,
      })
    ).toBe("whisper");
  });
});

describe("resolveRetryProvider with model-aware language coverage", () => {
  it("keeps Chinese on the sherpa engine when SenseVoice is the model", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "zh-CN",
        parakeetModel: "sense-voice-zh-en",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("parakeet");
  });

  it("routes Chinese away from Nemotron, whose export has no Chinese", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "zh-CN",
        parakeetModel: "nemotron-3.5-asr-streaming-0.6b",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("whisper");
  });

  it("falls back to the classic no-CJK heuristic for an unknown model", () => {
    expect(
      resolveRetryProvider({
        provider: "nvidia",
        language: "zh-CN",
        parakeetModel: "some-future-model",
        parakeetAvailable: true,
        whisperAvailable: true,
      })
    ).toBe("whisper");
  });
});

describe("resolveRetryLanguage", () => {
  it("sends auto as null so whisper detects, rather than translating", () => {
    // Forcing a language is what makes whisper translate: language=en on
    // Chinese speech returns English prose, language=zh on English speech
    // returns garbage. See eval/dictation-bench.
    expect(resolveRetryLanguage("auto")).toBeNull();
    expect(resolveRetryLanguage("")).toBeNull();
    expect(resolveRetryLanguage(null)).toBeNull();
  });

  it("strips the region so zh-CN reaches whisper as zh", () => {
    expect(resolveRetryLanguage("zh-CN")).toBe("zh");
    expect(resolveRetryLanguage("en")).toBe("en");
  });
});
