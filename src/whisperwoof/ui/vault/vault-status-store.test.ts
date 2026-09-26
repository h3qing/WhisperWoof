import { describe, it, expect, vi } from "vitest";
import type { VaultStatus } from "../../../types/electron";
import { createVaultStatusStore, type VaultStatusSource } from "./vault-status-store";

const status = (patch: Partial<VaultStatus> = {}): VaultStatus => ({
  status: "off",
  migrating: null,
  prefs: { touchId: false, lockOnSleep: true, idleMinutes: 0, notesReadable: false },
  touchId: { available: true },
  inboxCount: 0,
  lockDeferred: false,
  platformSupported: true,
  ...patch,
});

function fakeSource(initial: VaultStatus) {
  let push: ((s: VaultStatus) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    push = null;
  });
  const source: VaultStatusSource = {
    vaultGetStatus: vi.fn(async () => initial),
    onVaultStatus: vi.fn((cb) => {
      push = cb;
      return unsubscribe;
    }),
  };
  return { source, unsubscribe, push: (s: VaultStatus) => push?.(s) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createVaultStatusStore", () => {
  it("is unavailable (null) when the preload has no vault API", () => {
    const store = createVaultStatusStore(() => undefined);
    expect(store.getSnapshot()).toBeNull();
    const stop = store.subscribe(() => {});
    expect(store.getSnapshot()).toBeNull();
    stop();
  });

  it("loads (undefined) until the first status arrives, then notifies", async () => {
    const fake = fakeSource(status());
    const store = createVaultStatusStore(() => fake.source);
    expect(store.getSnapshot()).toBeUndefined();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    await flush();
    expect(store.getSnapshot()).toEqual(status());
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it("takes pushed status, and a late fetch doesn't overwrite a newer push", async () => {
    let resolveFetch: (s: VaultStatus) => void = () => {};
    const fake = fakeSource(status());
    fake.source.vaultGetStatus = () => new Promise((r) => (resolveFetch = r));
    const store = createVaultStatusStore(() => fake.source);
    const stop = store.subscribe(() => {});
    fake.push(status({ status: "locked" }));
    resolveFetch(status({ status: "off" }));
    await flush();
    expect(store.getSnapshot()?.status).toBe("locked");
    stop();
  });

  it("shares one IPC subscription and removes it with the last listener", () => {
    const fake = fakeSource(status());
    const store = createVaultStatusStore(() => fake.source);
    const a = store.subscribe(() => {});
    const b = store.subscribe(() => {});
    expect(fake.source.onVaultStatus).toHaveBeenCalledTimes(1);
    a();
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    b();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("treats a failed first fetch as unavailable, and refresh replaces the status", async () => {
    const fake = fakeSource(status());
    fake.source.vaultGetStatus = vi.fn(async () => {
      throw new Error("no handler");
    });
    const store = createVaultStatusStore(() => fake.source);
    const stop = store.subscribe(() => {});
    await flush();
    expect(store.getSnapshot()).toBeNull();
    fake.source.vaultGetStatus = vi.fn(async () => status({ status: "unlocked" }));
    await store.refresh();
    expect(store.getSnapshot()?.status).toBe("unlocked");
    stop();
  });
});
