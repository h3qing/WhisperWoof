// One shared view of the vault status for every component in a window. The
// status is fetched once and then follows the main process's pushes; the IPC
// subscription lives only while something is listening.

import type { VaultStatus } from "../../../types/electron";

export interface VaultStatusSource {
  vaultGetStatus?: () => Promise<VaultStatus>;
  onVaultStatus?: (callback: (status: VaultStatus) => void) => () => void;
}

/** `undefined` while loading, `null` when there is no vault (no API, or it failed). */
export type VaultSnapshot = VaultStatus | null | undefined;

export interface VaultStatusStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): VaultSnapshot;
  refresh(): Promise<void>;
}

export function createVaultStatusStore(
  getSource: () => VaultStatusSource | null | undefined
): VaultStatusStore {
  let snapshot: VaultSnapshot = undefined;
  let pushed = false;
  let stopIpc: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const source = () => {
    const s = getSource();
    return s?.vaultGetStatus ? s : null;
  };

  const set = (next: VaultSnapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const fetchStatus = async (keepNewerPush: boolean) => {
    const api = source();
    if (!api) return set(null);
    try {
      const next = await api.vaultGetStatus!();
      if (!(keepNewerPush && pushed)) set(next ?? null);
    } catch {
      if (snapshot === undefined) set(null);
    }
  };

  const start = () => {
    const api = source();
    if (!api) return set(null);
    pushed = false;
    stopIpc =
      api.onVaultStatus?.((next) => {
        pushed = true;
        set(next);
      }) ?? null;
    void fetchStatus(true);
  };

  const stop = () => {
    stopIpc?.();
    stopIpc = null;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot() {
      if (snapshot === undefined && !source()) snapshot = null;
      return snapshot;
    },
    refresh: () => fetchStatus(false),
  };
}
