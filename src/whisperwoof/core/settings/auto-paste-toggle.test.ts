import { describe, it, expect, beforeEach, vi } from "vitest";

const localStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get _store() {
      return store;
    },
  };
};

let mockStorage: ReturnType<typeof localStorageMock>;

beforeEach(() => {
  mockStorage = localStorageMock();
  vi.stubGlobal("window", { localStorage: mockStorage });
  vi.stubGlobal("localStorage", mockStorage);
  vi.resetModules();
});

describe("autoPasteEnabled — settings store", () => {
  it("defaults to true when localStorage has no value", async () => {
    const mod = await import("../../../stores/settingsStore");
    const state = mod.useSettingsStore.getState();
    expect(state.autoPasteEnabled).toBe(true);
  });

  it("reads stored false from localStorage", async () => {
    mockStorage.setItem("autoPasteEnabled", "false");
    const mod = await import("../../../stores/settingsStore");
    const state = mod.useSettingsStore.getState();
    expect(state.autoPasteEnabled).toBe(false);
  });

  it("setAutoPasteEnabled(false) updates store and persists to localStorage", async () => {
    const mod = await import("../../../stores/settingsStore");
    const store = mod.useSettingsStore;
    expect(store.getState().autoPasteEnabled).toBe(true);

    store.getState().setAutoPasteEnabled(false);

    expect(store.getState().autoPasteEnabled).toBe(false);
    expect(mockStorage.getItem("autoPasteEnabled")).toBe("false");
  });

  it("setAutoPasteEnabled(true) flips the value back", async () => {
    mockStorage.setItem("autoPasteEnabled", "false");
    const mod = await import("../../../stores/settingsStore");
    const store = mod.useSettingsStore;
    expect(store.getState().autoPasteEnabled).toBe(false);

    store.getState().setAutoPasteEnabled(true);

    expect(store.getState().autoPasteEnabled).toBe(true);
    expect(mockStorage.getItem("autoPasteEnabled")).toBe("true");
  });

  it("does not regress keepTranscriptionInClipboard default", async () => {
    const mod = await import("../../../stores/settingsStore");
    const state = mod.useSettingsStore.getState();
    expect(state.keepTranscriptionInClipboard).toBe(false);
  });
});
