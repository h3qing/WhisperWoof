import { describe, it, expect } from "vitest";
import { normalizeReasoningPrefsForSync } from "./startup-reasoning-prefs";
import modelData from "../../../models/modelRegistryData.json";

describe("normalizeReasoningPrefsForSync", () => {
  it("maps a local model-family id (qwen) to provider 'local' and keeps the model", () => {
    // Regression: ReasoningModelSelector writes the family id ("qwen") into
    // reasoningProvider. Main-process prewarm keys on exactly "local", so the
    // un-normalized value skipped prewarm AND stopped llama-server on every
    // settings sync — every dictation shipped the raw transcript.
    expect(normalizeReasoningPrefsForSync("qwen", "qwen3.5-2b-q4_k_m")).toEqual({
      reasoningProvider: "local",
      reasoningModel: "qwen3.5-2b-q4_k_m",
    });
  });

  it("maps every local provider family id from the registry data to 'local'", () => {
    for (const provider of modelData.localProviders) {
      const result = normalizeReasoningPrefsForSync(provider.id, "some-model");
      expect(result.reasoningProvider).toBe("local");
      expect(result.reasoningModel).toBe("some-model");
    }
  });

  it("passes 'local' through unchanged with its model", () => {
    expect(normalizeReasoningPrefsForSync("local", "llama-3.2-1b-instruct-q4_k_m")).toEqual({
      reasoningProvider: "local",
      reasoningModel: "llama-3.2-1b-instruct-q4_k_m",
    });
  });

  it("passes cloud providers through unchanged and omits the local model", () => {
    for (const cloud of ["openai", "anthropic", "gemini", "groq", "custom"]) {
      expect(normalizeReasoningPrefsForSync(cloud, "gpt-4o-mini")).toEqual({
        reasoningProvider: cloud,
        reasoningModel: undefined,
      });
    }
  });

  it("does not confuse cloud 'openai' with local 'openai-oss'", () => {
    expect(normalizeReasoningPrefsForSync("openai", "x").reasoningProvider).toBe("openai");
    expect(normalizeReasoningPrefsForSync("openai-oss", "gpt-oss-20b-mxfp4")).toEqual({
      reasoningProvider: "local",
      reasoningModel: "gpt-oss-20b-mxfp4",
    });
  });

  it("passes an empty provider through without a model", () => {
    expect(normalizeReasoningPrefsForSync("", "whatever")).toEqual({
      reasoningProvider: "",
      reasoningModel: undefined,
    });
  });
});
