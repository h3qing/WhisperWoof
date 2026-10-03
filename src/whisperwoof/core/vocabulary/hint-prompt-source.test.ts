/**
 * Where Whisper's hint prompt comes from: main's Memory + Dictionary + packs
 * prompt (clauses already left out), or — only when that IPC is missing or
 * fails — the renderer's raw Dictionary.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("../../../lib/neonAuth", () => ({ withSessionRefresh: (fn: () => unknown) => fn() }));
vi.mock("../../../services/ReasoningService", () => ({ default: {} }));

type Manager = {
  getPackEnhancedDictionaryPrompt: () => Promise<string | null>;
  getCustomDictionaryPrompt: () => string | null;
};
let AudioManagerClass: { prototype: Manager };
const electronAPI: Record<string, unknown> = {};

beforeAll(async () => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const base: Record<string, unknown> = { electronAPI, localStorage };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => {}) }));
  AudioManagerClass = (await import("../../../helpers/audioManager")).default;
});

afterAll(() => vi.unstubAllGlobals());

function managerWithDictionary(words: string): Manager {
  const manager = Object.create(AudioManagerClass.prototype) as Manager;
  manager.getCustomDictionaryPrompt = () => words;
  return manager;
}

describe("getPackEnhancedDictionaryPrompt", () => {
  it("uses main's prompt", async () => {
    electronAPI.whisperwoofGetPackEnhancedPrompt = async () => "Supabase, 王小明";
    expect(await managerWithDictionary("raw").getPackEnhancedDictionaryPrompt()).toBe("Supabase, 王小明");
  });

  it("sends no hints when main's prompt is empty (every word was a clause, or Memory is locked)", async () => {
    electronAPI.whisperwoofGetPackEnhancedPrompt = async () => "";
    expect(
      await managerWithDictionary("我在上海的课都是一节一节的").getPackEnhancedDictionaryPrompt(),
    ).toBeNull();
  });

  it("falls back to the renderer Dictionary only when the IPC is missing or fails", async () => {
    delete electronAPI.whisperwoofGetPackEnhancedPrompt;
    expect(await managerWithDictionary("Supabase").getPackEnhancedDictionaryPrompt()).toBe("Supabase");
    electronAPI.whisperwoofGetPackEnhancedPrompt = async () => {
      throw new Error("ipc down");
    };
    expect(await managerWithDictionary("Supabase").getPackEnhancedDictionaryPrompt()).toBe("Supabase");
  });
});
