/**
 * LLM Providers — BYOM (Bring Your Own Model) for text polish
 *
 * Abstracts away the LLM backend so users can choose between:
 * - Ollama (local, default, free)
 * - OpenAI (GPT-4o-mini, GPT-4o)
 * - Anthropic (Claude Haiku, Sonnet)
 * - Groq (fast cloud, Llama/Mixtral)
 *
 * Each provider implements the same interface:
 *   polish(text, systemPrompt, options) → { text, polished, elapsed, error? }
 *
 * Competitive feature: SuperWhisper lets users pick GPT/Claude/Llama.
 */

const debugLogger = require("../../helpers/debugLogger");

// --- Ollama model resolution ---
//
// When the configured Ollama model isn't installed, polish requests 404
// silently. We pre-check /api/tags and, if necessary, fall back to a known-
// good installed model. /api/tags is cached briefly so a misconfigured model
// doesn't add an extra HTTP round-trip to every polish call.

const OLLAMA_TAGS_CACHE_TTL_MS = 30_000;
const ollamaTagsCache = new Map(); // baseUrl → { models, expiresAt }

// Ranked by polish quality on dictation transcripts at the small-model size
// most users run locally. First match in the list wins.
const PREFERRED_OLLAMA_FALLBACKS = [
  "qwen2.5:3b",
  "llama3.2:3b",
  "qwen2.5:7b",
  "llama3.1:8b",
  "llama3.2:1b",
];

async function fetchOllamaInstalledModels(baseUrl) {
  const cached = ollamaTagsCache.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const models = (data?.models || []).map((m) => m?.name).filter(Boolean);
    ollamaTagsCache.set(baseUrl, {
      models,
      expiresAt: Date.now() + OLLAMA_TAGS_CACHE_TTL_MS,
    });
    return models;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function resolveOllamaModel(baseUrl, requestedModel) {
  const installed = await fetchOllamaInstalledModels(baseUrl);
  // /api/tags unreachable → trust the configured model, let the chat call fail loud.
  if (!installed) return { model: requestedModel, fellBack: false };
  if (installed.includes(requestedModel)) {
    return { model: requestedModel, fellBack: false };
  }
  if (installed.length === 0) {
    return { model: requestedModel, fellBack: false };
  }
  const preferred = PREFERRED_OLLAMA_FALLBACKS.find((name) => installed.includes(name));
  return {
    model: preferred || installed[0],
    fellBack: true,
    requested: requestedModel,
    available: installed,
  };
}

// --- Provider implementations ---

async function polishOllama(text, systemPrompt, options) {
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const requestedModel = options.model || "llama3.2:1b";
  // 15s default — covers cold-start of 1B-3B models on Apple Silicon.
  // Warm calls return in <2s; the timeout only matters when ollama unloads
  // the model after its keep-alive window or after a fresh `ollama serve`.
  const timeoutMs = options.timeoutMs || 15000;

  const resolved = await resolveOllamaModel(baseUrl, requestedModel);
  if (resolved.fellBack) {
    debugLogger.warn("[WhisperWoof] Configured Ollama model not installed — falling back", {
      requested: resolved.requested,
      using: resolved.model,
      available: resolved.available,
    });
  }
  const model = resolved.model;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      stream: false,
      options: { temperature: 0.2, num_predict: 512, top_p: 0.9 },
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  return data?.message?.content?.trim() || "";
}

async function polishOpenAI(text, systemPrompt, options) {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("OpenAI API key not configured");

  const model = options.model || "gpt-4o-mini";
  const timeoutMs = options.timeoutMs || 10000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function polishAnthropic(text, systemPrompt, options) {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("Anthropic API key not configured");

  const model = options.model || "claude-haiku-4-5-20251001";
  const timeoutMs = options.timeoutMs || 10000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
      max_tokens: 512,
      temperature: 0.2,
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.content?.[0]?.text?.trim() || "";
}

async function polishGroq(text, systemPrompt, options) {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("Groq API key not configured");

  const model = options.model || "llama-3.1-8b-instant";
  const timeoutMs = options.timeoutMs || 8000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Groq uses the OpenAI-compatible API
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

// --- Provider registry ---

const PROVIDERS = {
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Free, private, runs on your machine. Requires Ollama installed.",
    requiresApiKey: false,
    defaultModel: "llama3.2:1b",
    models: ["llama3.2:1b", "llama3.2:3b", "llama3.1:8b", "mistral:7b", "gemma2:2b"],
    polish: polishOllama,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o-mini (fast, cheap) or GPT-4o (best quality). Requires API key.",
    requiresApiKey: true,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"],
    polish: polishOpenAI,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Haiku (fast) or Sonnet (quality). Requires API key.",
    requiresApiKey: true,
    defaultModel: "claude-haiku-4-5-20251001",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6-20250514"],
    polish: polishAnthropic,
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast cloud inference. Free tier available. Requires API key.",
    requiresApiKey: true,
    defaultModel: "llama-3.1-8b-instant",
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    polish: polishGroq,
  },
};

/**
 * Get list of available providers (for settings UI).
 */
function getProviders() {
  return Object.values(PROVIDERS).map(({ id, name, description, requiresApiKey, defaultModel, models }) => ({
    id, name, description, requiresApiKey, defaultModel, models,
  }));
}

/**
 * Validate a provider config (provider id + api key presence).
 * Returns null if valid, or a human-readable error string.
 *
 * Extracted so tests can exercise the real check directly instead of
 * reimplementing the registry lookup and api-key gate in parallel.
 */
function validateConfig(config = {}) {
  const providerId = config.provider || "ollama";
  const provider = PROVIDERS[providerId];
  if (!provider) return `Unknown provider: ${providerId}`;
  if (provider.requiresApiKey && !config.apiKey) return `${provider.name} requires an API key`;
  return null;
}

/**
 * Polish text using the configured provider.
 * Falls back to raw text on any failure.
 *
 * @param {string} text - Raw transcript
 * @param {string} systemPrompt - Polish instructions
 * @param {object} config - { provider, model, apiKey, baseUrl, timeoutMs }
 */
async function polishWithProvider(text, systemPrompt, config = {}) {
  const validationError = validateConfig(config);
  if (validationError) {
    return { text, polished: false, error: validationError };
  }

  const providerId = config.provider || "ollama";
  const provider = PROVIDERS[providerId];

  const startTime = Date.now();

  try {
    const result = await provider.polish(text, systemPrompt, {
      model: config.model || provider.defaultModel,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs || (providerId === "ollama" ? 15000 : 10000),
    });

    if (!result) {
      return { text, polished: false, error: "Empty response" };
    }

    const elapsed = Date.now() - startTime;
    debugLogger.info(`[WhisperWoof] ${provider.name} polish completed`, {
      model: config.model || provider.defaultModel,
      elapsed,
      inputLen: text.length,
      outputLen: result.length,
    });

    return { text: result, polished: true, elapsed, provider: providerId };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const message = err.name === "AbortError" ? "Timeout" : err.message;
    debugLogger.warn(`[WhisperWoof] ${provider.name} polish failed`, { error: message, elapsed });
    return { text, polished: false, error: message, provider: providerId };
  }
}

module.exports = {
  getProviders,
  polishWithProvider,
  validateConfig,
  PROVIDERS,
  // Exported for tests; not part of the public surface.
  resolveOllamaModel,
  PREFERRED_OLLAMA_FALLBACKS,
};
