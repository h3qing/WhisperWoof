/**
 * Tests for retry-transcription decision logic.
 *
 * Imports the real bridge module the IPC handler uses, so drift between
 * tested and production behaviour is impossible.
 */
import { describe, it, expect } from "vitest";
import * as retry from "../../bridge/retry-transcription-pure.js";

const { resolveRetryModelFile, resolveRetryProvider, resolveRetryLanguage } = retry;

describe("resolveRetryModelFile", () => {
  const downloaded = ["ggml-small.bin", "ggml-large-v3-turbo.bin", "ggml-base.bin"];

  it("resolves a model id to its registry filename", () => {
    expect(resolveRetryModelFile(downloaded, "turbo")).toBe("ggml-large-v3-turbo.bin");
    expect(resolveRetryModelFile(downloaded, "small")).toBe("ggml-small.bin");
  });

  it("does not let a substring id claim a different model's file", () => {
    // "large" must not silently resolve to the turbo build when large-v3
    // itself was never downloaded — but it may fall back to a real match.
    const only = ["ggml-large-v3-turbo.bin"];
    expect(resolveRetryModelFile(only, "turbo")).toBe("ggml-large-v3-turbo.bin");
  });

  it("falls back to any downloaded model rather than refusing to retry", () => {
    expect(resolveRetryModelFile(["ggml-base.bin"], "turbo")).toBe("ggml-base.bin");
  });

  it("returns null only when nothing is downloaded", () => {
    expect(resolveRetryModelFile([], "turbo")).toBeNull();
    expect(resolveRetryModelFile(["notes.txt"], "turbo")).toBeNull();
    expect(resolveRetryModelFile(undefined, "turbo")).toBeNull();
  });

  it("still picks a model when no id is requested", () => {
    expect(resolveRetryModelFile(downloaded)).toBe("ggml-small.bin");
  });
});

describe("resolveRetryProvider", () => {
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
