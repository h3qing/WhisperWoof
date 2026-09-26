import { useEffect, useRef, useSyncExternalStore } from "react";
import { createVaultStatusStore, type VaultSnapshot } from "./vault-status-store";
import { needsLockScreen, shouldReloadOnTransition } from "./vault-ui-pure";

/** The preload bridge, or null outside Electron (tests, the website). */
export function vaultApi(): Window["electronAPI"] | null {
  return typeof window !== "undefined" ? (window.electronAPI ?? null) : null;
}

const store = createVaultStatusStore(vaultApi);

export function useVaultStatus(): { status: VaultSnapshot; refresh: () => Promise<void> } {
  const status = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { status, refresh: store.refresh };
}

/**
 * What the control panel needs: whether to wait, and whether to show the lock
 * screen. Crossing the lock reloads the window so no decrypted state survives
 * a lock and every store reloads after an unlock.
 */
export function useVaultGate() {
  const { status, refresh } = useVaultStatus();
  const previous = useRef<VaultSnapshot>(status);

  useEffect(() => {
    if (shouldReloadOnTransition(previous.current, status)) window.location.reload();
    previous.current = status;
  }, [status]);

  return { pending: status === undefined, locked: needsLockScreen(status), status, refresh };
}
