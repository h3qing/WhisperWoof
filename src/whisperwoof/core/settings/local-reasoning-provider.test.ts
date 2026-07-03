import { describe, it, expect } from "vitest";
import {
  isLocalReasoningProvider,
  isLocalProviderFamilyId,
  migrateStaleReasoningProvider,
  resolveLocalFamilyTab,
  LOCAL_REASONING_PROVIDER,
  DEFAULT_LOCAL_FAMILY,
} from "./local-reasoning-provider";
import modelData from "../../../models/modelRegistryData.json";

describe("isLocalReasoningProvider", () => {
  it("accepts the canonical 'local'", () => {
    expect(isLocalReasoningProvider("local")).toBe(true);
  });

  it("accepts every stale family id from the registry", () => {
    for (const provider of modelData.localProviders) {
      expect(isLocalReasoningProvider(provider.id)).toBe(true);
    }
  });

  it("rejects cloud providers, custom, and empty", () => {
    for (const value of ["openai", "anthropic", "gemini", "groq", "custom", "openwhispr", ""]) {
      expect(isLocalReasoningProvider(value)).toBe(false);
    }
  });

  it("does not confuse cloud 'openai' with local 'openai-oss'", () => {
    expect(isLocalReasoningProvider("openai")).toBe(false);
    expect(isLocalReasoningProvider("openai-oss")).toBe(true);
  });
});

describe("migrateStaleReasoningProvider", () => {
  it("maps a stale family id to 'local' and preserves it as the tab", () => {
    expect(migrateStaleReasoningProvider("qwen", null)).toEqual({
      reasoningProvider: "local",
      localFamily: "qwen",
    });
  });

  it("migrates every family id from the registry", () => {
    for (const provider of modelData.localProviders) {
      expect(migrateStaleReasoningProvider(provider.id, null)).toEqual({
        reasoningProvider: "local",
        localFamily: provider.id,
      });
    }
  });

  it("keeps an already-valid persisted family tab", () => {
    expect(migrateStaleReasoningProvider("qwen", "gemma")).toEqual({
      reasoningProvider: "local",
      localFamily: "gemma",
    });
  });

  it("replaces an invalid persisted family tab with the stale provider id", () => {
    expect(migrateStaleReasoningProvider("llama", "not-a-family")).toEqual({
      reasoningProvider: "local",
      localFamily: "llama",
    });
  });

  it("returns null when nothing needs migrating", () => {
    expect(migrateStaleReasoningProvider("local", null)).toBeNull();
    expect(migrateStaleReasoningProvider("openai", null)).toBeNull();
    expect(migrateStaleReasoningProvider("custom", null)).toBeNull();
    expect(migrateStaleReasoningProvider("", null)).toBeNull();
    expect(migrateStaleReasoningProvider(null, null)).toBeNull();
  });
});

describe("resolveLocalFamilyTab", () => {
  it("prefers a stale family id stored in the provider setting", () => {
    expect(resolveLocalFamilyTab("gemma", "qwen3.5-2b-q4_k_m", "llama")).toBe("gemma");
  });

  it("derives the tab from the selected model when provider is 'local'", () => {
    // Persisted "gemma" makes this diagnostic: a lookup miss would fall back to
    // the persisted tab instead of coincidentally matching the "qwen" default.
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "qwen3.5-2b-q4_k_m", "gemma")).toBe(
      "qwen"
    );
    expect(
      resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "llama-3.2-1b-instruct-q4_k_m", "gemma")
    ).toBe("llama");
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "gpt-oss-20b-mxfp4", null)).toBe(
      "openai-oss"
    );
  });

  it("falls back to the persisted tab when no model is selected", () => {
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "", "gemma")).toBe("gemma");
  });

  it("ignores an invalid persisted tab and uses the default", () => {
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "", "bogus")).toBe(
      DEFAULT_LOCAL_FAMILY
    );
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "", null)).toBe(DEFAULT_LOCAL_FAMILY);
  });

  it("uses the default for an unknown model with no persisted tab", () => {
    expect(resolveLocalFamilyTab(LOCAL_REASONING_PROVIDER, "unknown-model", null)).toBe(
      DEFAULT_LOCAL_FAMILY
    );
  });
});

describe("registry sanity", () => {
  it("the registry has local providers (guards the loop-driven tests against vacuity)", () => {
    expect(modelData.localProviders.length).toBeGreaterThan(0);
  });

  it("every registry family id is recognized", () => {
    for (const provider of modelData.localProviders) {
      expect(isLocalProviderFamilyId(provider.id)).toBe(true);
    }
  });

  it("'local' itself is not a family id", () => {
    expect(isLocalProviderFamilyId("local")).toBe(false);
  });
});
