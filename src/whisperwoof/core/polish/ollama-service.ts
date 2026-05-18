/**
 * OllamaService — WhisperWoof LLM Polish Pipeline
 *
 * Calls the Ollama HTTP API (localhost:11434) to polish raw voice transcripts.
 * Gracefully degrades to raw text on ANY failure (network, timeout, bad response).
 *
 * Immutability: all returned objects are readonly; inputs are never mutated.
 */

import type { PolishConfig, PolishResult, OllamaStatus } from './types';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2:1b';
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 1024;

const DEFAULT_SYSTEM_PROMPT =
  'You are a transcript polisher. Clean up the following raw voice transcript: ' +
  'fix grammar, punctuation, and formatting. Keep the original meaning. ' +
  'Return ONLY the polished text, nothing else.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

function rawFallback(
  rawText: string,
  startTime: number,
  error: string | null,
): Readonly<PolishResult> {
  return Object.freeze({
    text: rawText,
    wasPolished: false,
    model: null,
    elapsedMs: Date.now() - startTime,
    error,
  });
}

function buildPolishBody(
  rawText: string,
  config: Required<Pick<PolishConfig, 'model' | 'temperature' | 'maxTokens' | 'systemPrompt'>>,
): string {
  return JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: rawText },
    ],
    stream: false,
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens,
    },
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OllamaService
// ---------------------------------------------------------------------------

export class OllamaService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // polish
  // -------------------------------------------------------------------------

  async polish(
    rawText: string,
    config?: PolishConfig,
  ): Promise<Readonly<PolishResult>> {
    const startTime = Date.now();

    if (isBlank(rawText)) {
      return rawFallback(rawText ?? '', startTime, null);
    }

    const model = config?.model ?? DEFAULT_MODEL;
    const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const temperature = config?.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const systemPrompt = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    try {
      const polished = await this.callChatApi(
        rawText,
        { model, temperature, maxTokens, systemPrompt },
        timeoutMs,
      );

      if (isBlank(polished)) {
        return rawFallback(rawText, startTime, 'Ollama returned empty response');
      }

      return Object.freeze({
        text: polished,
        wasPolished: true,
        model,
        elapsedMs: Date.now() - startTime,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return rawFallback(rawText, startTime, message);
    }
  }

  // -------------------------------------------------------------------------
  // checkAvailability
  // -------------------------------------------------------------------------

  async checkAvailability(): Promise<Readonly<OllamaStatus>> {
    const notInstalled: Readonly<OllamaStatus> = Object.freeze({
      installed: false,
      running: false,
      modelsAvailable: [],
    });

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        DEFAULT_TIMEOUT_MS,
      );

      if (!response.ok) {
        return notInstalled;
      }

      const data: unknown = await response.json();
      const models = parseModelNames(data);

      return Object.freeze({
        installed: true,
        running: true,
        modelsAvailable: Object.freeze(models),
      });
    } catch {
      return notInstalled;
    }
  }

  // -------------------------------------------------------------------------
  // startOllama
  // -------------------------------------------------------------------------

  async startOllama(): Promise<void> {
    const { exec } = await import('child_process');

    return new Promise<void>((resolve, reject) => {
      const child = exec('ollama serve', { timeout: 5000 });

      // Fire-and-forget: resolve once spawned, the server runs in background
      child.on('spawn', () => resolve());
      child.on('error', (err) => reject(new Error(`Failed to start Ollama: ${err.message}`)));
    });
  }

  // -------------------------------------------------------------------------
  // pullModel
  // -------------------------------------------------------------------------

  async pullModel(model: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/pull`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: false }),
      },
      300_000, // model pulls can take minutes
    );

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new Error(`Failed to pull model "${model}": ${response.status} — ${body}`);
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async callChatApi(
    rawText: string,
    config: Required<Pick<PolishConfig, 'model' | 'temperature' | 'maxTokens' | 'systemPrompt'>>,
    timeoutMs: number,
  ): Promise<string> {
    const body = buildPolishBody(rawText, config);

    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      timeoutMs,
    );

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    return parsePolishedText(data);
  }
}

// ---------------------------------------------------------------------------
// Response parsers (pure functions)
// ---------------------------------------------------------------------------

function parsePolishedText(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof (data as Record<string, unknown>).message === 'object' &&
    (data as Record<string, unknown>).message !== null
  ) {
    const message = (data as { message: Record<string, unknown> }).message;
    if (typeof message.content === 'string') {
      return message.content.trim();
    }
  }
  throw new Error('Malformed Ollama response: missing message.content');
}

function parseModelNames(data: unknown): readonly string[] {
  if (
    typeof data === 'object' &&
    data !== null &&
    'models' in data &&
    Array.isArray((data as Record<string, unknown>).models)
  ) {
    const models = (data as { models: unknown[] }).models;
    return models
      .map((m) =>
        typeof m === 'object' && m !== null && 'name' in m && typeof (m as Record<string, unknown>).name === 'string'
          ? (m as { name: string }).name
          : null,
      )
      .filter((name): name is string => name !== null);
  }
  return [];
}
