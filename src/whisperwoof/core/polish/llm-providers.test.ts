/**
 * Tests for the LLM Provider System (BYOM).
 *
 * Imports `PROVIDERS`, `getProviders`, and `validateConfig` from the real
 * bridge/llm-providers.js module so drift between the registry the runtime
 * uses and the registry the test asserts is impossible. Actual network
 * calls (`polishWithProvider`) are out of scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  PROVIDERS,
  getProviders,
  validateConfig,
  resolveOllamaModel,
  PREFERRED_OLLAMA_FALLBACKS,
} from "../../bridge/llm-providers";

describe("provider registry", () => {
  it("has 4 providers", () => {
    expect(getProviders()).toHaveLength(4);
  });

  it("includes ollama, openai, anthropic, groq", () => {
    const ids = getProviders().map((p: { id: string }) => p.id);
    expect(ids).toContain("ollama");
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("groq");
  });

  it("ollama does not require an API key", () => {
    expect(PROVIDERS.ollama.requiresApiKey).toBe(false);
  });

  it("cloud providers require API keys", () => {
    expect(PROVIDERS.openai.requiresApiKey).toBe(true);
    expect(PROVIDERS.anthropic.requiresApiKey).toBe(true);
    expect(PROVIDERS.groq.requiresApiKey).toBe(true);
  });

  it("each provider has a default model", () => {
    for (const provider of getProviders() as { defaultModel: string; models: string[] }[]) {
      expect(provider.defaultModel).toBeTruthy();
      expect(provider.models).toContain(provider.defaultModel);
    }
  });

  it("each provider has at least 2 model options", () => {
    for (const provider of getProviders() as { models: string[] }[]) {
      expect(provider.models.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("all provider IDs are unique", () => {
    const ids = getProviders().map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("validateConfig", () => {
  it("ollama with no API key is valid", () => {
    expect(validateConfig({ provider: "ollama" })).toBeNull();
  });

  it("openai without API key returns an error", () => {
    expect(validateConfig({ provider: "openai" })).toContain("requires an API key");
  });

  it("openai with API key is valid", () => {
    expect(validateConfig({ provider: "openai", apiKey: "sk-test" })).toBeNull();
  });

  it("anthropic without API key returns an error", () => {
    expect(validateConfig({ provider: "anthropic" })).toContain("requires an API key");
  });

  it("anthropic with API key is valid", () => {
    expect(validateConfig({ provider: "anthropic", apiKey: "sk-ant-test" })).toBeNull();
  });

  it("groq without API key returns an error", () => {
    expect(validateConfig({ provider: "groq" })).toContain("requires an API key");
  });

  it("groq with API key is valid", () => {
    expect(validateConfig({ provider: "groq", apiKey: "gsk-test" })).toBeNull();
  });

  it("unknown provider returns an error", () => {
    expect(validateConfig({ provider: "cohere" })).toContain("Unknown provider");
  });

  it("defaults to ollama when no provider specified", () => {
    expect(validateConfig({})).toBeNull();
  });
});

describe("model listings", () => {
  it("ollama lists local models", () => {
    expect(PROVIDERS.ollama.models).toContain("llama3.2:1b");
    expect(PROVIDERS.ollama.models).toContain("llama3.2:3b");
  });

  it("openai lists GPT models", () => {
    expect(PROVIDERS.openai.models).toContain("gpt-4o-mini");
    expect(PROVIDERS.openai.models).toContain("gpt-4o");
  });

  it("anthropic lists Claude models", () => {
    expect(PROVIDERS.anthropic.models).toContain("claude-haiku-4-5-20251001");
    expect(PROVIDERS.anthropic.models).toContain("claude-sonnet-4-6-20250514");
  });

  it("groq lists fast inference models", () => {
    expect(PROVIDERS.groq.models).toContain("llama-3.1-8b-instant");
    expect(PROVIDERS.groq.models).toContain("llama-3.3-70b-versatile");
  });
});

// ---------------------------------------------------------------------------
// resolveOllamaModel — fallback when the configured model isn't installed
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tagsResponse(models: string[]): Response {
  return new Response(
    JSON.stringify({ models: models.map((name) => ({ name })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("resolveOllamaModel", () => {
  // Cache lasts 30s — use a unique baseUrl per test so the cache doesn't
  // mask behavior under test. The cache itself is exercised separately.
  let counter = 0;
  const freshUrl = () => `http://localhost:11434/test-${counter++}`;

  it("returns the requested model when it is installed", async () => {
    mockFetch.mockResolvedValueOnce(tagsResponse(["llama3.2:1b", "qwen2.5:3b"]));
    const out = await resolveOllamaModel(freshUrl(), "qwen2.5:3b");
    expect(out.fellBack).toBe(false);
    expect(out.model).toBe("qwen2.5:3b");
  });

  it("falls back to a preferred installed model when the configured one is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      tagsResponse(["moondream:latest", "qwen2.5:3b", "llama3.2:1b"]),
    );
    const out = await resolveOllamaModel(freshUrl(), "qwen3.5-2b-q4_k_m");
    expect(out.fellBack).toBe(true);
    expect(out.model).toBe("qwen2.5:3b");
    expect(out.requested).toBe("qwen3.5-2b-q4_k_m");
    expect(out.available).toContain("qwen2.5:3b");
  });

  it("prefers higher-quality models from the ranked fallback list", () => {
    // Sanity-check: the static list is in the order documented in the source
    expect(PREFERRED_OLLAMA_FALLBACKS[0]).toBe("qwen2.5:3b");
    expect(PREFERRED_OLLAMA_FALLBACKS).toContain("llama3.2:3b");
    expect(PREFERRED_OLLAMA_FALLBACKS).toContain("llama3.2:1b");
  });

  it("falls back to the first installed model when none match the preferred list", async () => {
    mockFetch.mockResolvedValueOnce(tagsResponse(["mistral:7b", "phi3:mini"]));
    const out = await resolveOllamaModel(freshUrl(), "qwen3.5-2b-q4_k_m");
    expect(out.fellBack).toBe(true);
    expect(out.model).toBe("mistral:7b");
  });

  it("does not fall back when /api/tags is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const out = await resolveOllamaModel(freshUrl(), "some-model:latest");
    expect(out.fellBack).toBe(false);
    expect(out.model).toBe("some-model:latest");
  });

  it("does not fall back when /api/tags returns no models", async () => {
    mockFetch.mockResolvedValueOnce(tagsResponse([]));
    const out = await resolveOllamaModel(freshUrl(), "missing:latest");
    expect(out.fellBack).toBe(false);
    expect(out.model).toBe("missing:latest");
  });

  it("does not fall back on a non-OK /api/tags response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    const out = await resolveOllamaModel(freshUrl(), "missing:latest");
    expect(out.fellBack).toBe(false);
    expect(out.model).toBe("missing:latest");
  });

  it("caches /api/tags so repeated calls don't re-fetch", async () => {
    const url = freshUrl();
    mockFetch.mockResolvedValueOnce(tagsResponse(["llama3.2:1b"]));
    await resolveOllamaModel(url, "llama3.2:1b");
    await resolveOllamaModel(url, "llama3.2:1b");
    await resolveOllamaModel(url, "qwen3.5-2b-q4_k_m");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
