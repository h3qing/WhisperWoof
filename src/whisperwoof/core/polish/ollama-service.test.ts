import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaService } from './ollama-service';
import type { PolishConfig } from './types';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ollamaChatResponse(content: string): Response {
  return new Response(
    JSON.stringify({ message: { role: 'assistant', content } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function ollamaTagsResponse(models: string[]): Response {
  return new Response(
    JSON.stringify({ models: models.map((name) => ({ name })) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// polish()
// ---------------------------------------------------------------------------

describe('OllamaService.polish', () => {
  it('returns polished text on successful Ollama response', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('Hello, world!'));

    const service = new OllamaService();
    const result = await service.polish('hello world');

    expect(result.wasPolished).toBe(true);
    expect(result.text).toBe('Hello, world!');
    expect(result.model).toBe('llama3.2:1b');
    expect(result.error).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('uses custom config when provided', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('Polished.'));

    const config: PolishConfig = {
      model: 'mistral:7b',
      timeoutMs: 5000,
      temperature: 0.5,
      maxTokens: 512,
      systemPrompt: 'Fix it.',
    };

    const service = new OllamaService();
    const result = await service.polish('raw text', config);

    expect(result.wasPolished).toBe(true);
    expect(result.model).toBe('mistral:7b');

    // Verify the request body includes custom model
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.model).toBe('mistral:7b');
    expect(body.messages[0].content).toBe('Fix it.');
    expect(body.options.temperature).toBe(0.5);
    expect(body.options.num_predict).toBe(512);
  });

  it('returns raw text when Ollama is not running (fetch rejects)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const service = new OllamaService();
    const result = await service.polish('raw transcript');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('raw transcript');
    expect(result.model).toBeNull();
    expect(result.error).toBe('Connection refused');
  });

  it('returns raw text on timeout (AbortError)', async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        // Simulate AbortController aborting
        const err = new DOMException('The operation was aborted.', 'AbortError');
        setTimeout(() => reject(err), 10);
      }),
    );

    const service = new OllamaService();
    const result = await service.polish('hello', { timeoutMs: 5 });

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('hello');
    expect(result.error).toBeTruthy();
  });

  it('returns raw text when input is empty string', async () => {
    const service = new OllamaService();
    const result = await service.polish('');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('');
    expect(result.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns raw text when input is whitespace-only', async () => {
    const service = new OllamaService();
    const result = await service.polish('   \n\t  ');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('   \n\t  ');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns raw text when Ollama returns malformed JSON', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('not json', { status: 200 }),
    );

    const service = new OllamaService();
    const result = await service.polish('test input');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('test input');
    expect(result.error).toBeTruthy();
  });

  it('returns raw text when Ollama returns JSON without message.content', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const service = new OllamaService();
    const result = await service.polish('test input');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('test input');
    expect(result.error).toContain('Malformed');
  });

  it('returns raw text when Ollama returns HTTP error status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const service = new OllamaService();
    const result = await service.polish('test input');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('test input');
    expect(result.error).toContain('500');
  });

  it('returns raw text when Ollama returns empty content', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('   '));

    const service = new OllamaService();
    const result = await service.polish('test input');

    expect(result.wasPolished).toBe(false);
    expect(result.text).toBe('test input');
    expect(result.error).toContain('empty');
  });

  it('does not mutate the config parameter', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('polished'));

    const config: PolishConfig = { model: 'test' };
    const configCopy = { ...config };

    const service = new OllamaService();
    await service.polish('input', config);

    expect(config).toEqual(configCopy);
  });

  it('returns a frozen (immutable) result object', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('polished'));

    const service = new OllamaService();
    const result = await service.polish('input');

    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkAvailability()
// ---------------------------------------------------------------------------

describe('OllamaService.checkAvailability', () => {
  it('returns running status with available models', async () => {
    mockFetch.mockResolvedValueOnce(ollamaTagsResponse(['llama3.2:1b', 'mistral:7b']));

    const service = new OllamaService();
    const status = await service.checkAvailability();

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.modelsAvailable).toEqual(['llama3.2:1b', 'mistral:7b']);
  });

  it('returns not installed when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const service = new OllamaService();
    const status = await service.checkAvailability();

    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
    expect(status.modelsAvailable).toEqual([]);
  });

  it('returns not installed when Ollama returns non-OK status', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));

    const service = new OllamaService();
    const status = await service.checkAvailability();

    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
  });

  it('handles malformed tags response gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ noModelsKey: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const service = new OllamaService();
    const status = await service.checkAvailability();

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.modelsAvailable).toEqual([]);
  });

  it('returns a frozen (immutable) status object', async () => {
    mockFetch.mockResolvedValueOnce(ollamaTagsResponse(['model1']));

    const service = new OllamaService();
    const status = await service.checkAvailability();

    expect(Object.isFrozen(status)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pullModel()
// ---------------------------------------------------------------------------

describe('OllamaService.pullModel', () => {
  it('resolves on successful pull', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'success' }), { status: 200 }),
    );

    const service = new OllamaService();
    await expect(service.pullModel('llama3.2:1b')).resolves.toBeUndefined();

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe('llama3.2:1b');
  });

  it('throws on failed pull', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('model not found', { status: 404 }),
    );

    const service = new OllamaService();
    await expect(service.pullModel('nonexistent')).rejects.toThrow('Failed to pull model');
  });
});

// ---------------------------------------------------------------------------
// constructor baseUrl
// ---------------------------------------------------------------------------

describe('OllamaService constructor', () => {
  it('uses custom base URL', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('ok'));

    const service = new OllamaService('http://remote:9999');
    await service.polish('test');

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('http://remote:9999');
  });
});

// ---------------------------------------------------------------------------
// Default system prompt content
// ---------------------------------------------------------------------------

describe('Default system prompt', () => {
  it('contains the core cleanup instruction', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('polished'));

    const service = new OllamaService();
    await service.polish('test input');

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    const systemPrompt: string = body.messages[0].content;

    expect(systemPrompt).toMatch(/grammar/i);
    expect(systemPrompt).toMatch(/punctuation/i);
    expect(systemPrompt).toMatch(/return only/i);
  });

  // Regression guard: small models (1B-3B) latch onto subjective instructions
  // like "detect topic changes" and "format each item on its own line", which
  // produce duplicated paragraphs, Title Case, and "Here is the cleaned-up
  // version:" preambles. Keep the default prompt minimal and direct.
  it('does NOT include subjective topic-detection rules', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('polished'));

    const service = new OllamaService();
    await service.polish('test input');

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    const systemPrompt: string = body.messages[0].content;

    expect(systemPrompt).not.toMatch(/different topic/i);
    expect(systemPrompt).not.toMatch(/new paragraph/i);
    expect(systemPrompt).not.toMatch(/each item on its own line/i);
  });

  it('custom systemPrompt fully overrides the default', async () => {
    mockFetch.mockResolvedValueOnce(ollamaChatResponse('custom result'));

    const service = new OllamaService();
    await service.polish('test input', { systemPrompt: 'Just fix typos.' });

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    const systemPrompt: string = body.messages[0].content;

    expect(systemPrompt).toBe('Just fix typos.');
  });
});
