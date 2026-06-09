import { describe, it, expect } from "vitest";

const { WHISPER_FALLBACK_PREFERENCE, pickBestDownloadedModel } = require("../../../helpers/whisperModelFallback");

describe("pickBestDownloadedModel — seamless STT fallback", () => {
  it("returns null when nothing is downloaded", () => {
    expect(pickBestDownloadedModel([])).toBeNull();
    expect(pickBestDownloadedModel(undefined)).toBeNull();
  });

  it("prefers the best multilingual model (turbo) when several are present", () => {
    // The real scenario from the bug: user has these on disk, selected an
    // un-downloaded 'small' → should land on turbo, not tiny.
    expect(pickBestDownloadedModel(["base", "distil-large-v3", "turbo", "large", "tiny"])).toBe(
      "turbo"
    );
  });

  it("falls to large, then medium, then small when turbo is absent", () => {
    expect(pickBestDownloadedModel(["large", "base", "tiny"])).toBe("large");
    expect(pickBestDownloadedModel(["medium", "base", "tiny"])).toBe("medium");
    expect(pickBestDownloadedModel(["small", "base", "tiny"])).toBe("small");
  });

  it("prefers a multilingual model over an English-only distil model", () => {
    // A bilingual user must not be silently downgraded onto English-only.
    expect(pickBestDownloadedModel(["distil-large-v3", "base"])).toBe("base");
    expect(pickBestDownloadedModel(["distil-large-v3.5", "tiny"])).toBe("distil-large-v3.5");
  });

  it("uses tiny only as the last resort", () => {
    expect(pickBestDownloadedModel(["tiny"])).toBe("tiny");
  });

  it("still returns a downloaded model not in the preference list", () => {
    expect(pickBestDownloadedModel(["some-custom-model"])).toBe("some-custom-model");
  });

  it("preference list is multilingual-first with tiny last", () => {
    expect(WHISPER_FALLBACK_PREFERENCE[0]).toBe("turbo");
    expect(WHISPER_FALLBACK_PREFERENCE[WHISPER_FALLBACK_PREFERENCE.length - 1]).toBe("tiny");
    // distil (English-only) ranks below the multilingual models
    expect(WHISPER_FALLBACK_PREFERENCE.indexOf("base")).toBeLessThan(
      WHISPER_FALLBACK_PREFERENCE.indexOf("distil-large-v3")
    );
  });
});
