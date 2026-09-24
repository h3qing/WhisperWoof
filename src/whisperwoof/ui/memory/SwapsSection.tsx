/**
 * SwapsSection — the "Automatic fixes" part of the Memory view. Loads the
 * approved swaps and stays current: it refetches when a swap is approved,
 * stopped or reverted anywhere (the memory-swaps-updated broadcast) and when
 * the Memory words change (`refreshKey`, e.g. a word was deleted).
 */

import { useCallback, useEffect, useState } from "react";
import { Replace } from "lucide-react";
import { SwapsList, type Swap } from "./SwapsList";

interface SwapsAPI {
  whisperwoofGetMemorySwaps?: () => Promise<Swap[]>;
  declineMemorySwap?: (from: string, to: string) => Promise<{ success: boolean }>;
  onMemorySwapsUpdated?: (callback: () => void) => () => void;
}

function getAPI(): SwapsAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

export default function SwapsSection({ refreshKey }: { readonly refreshKey?: unknown }) {
  const [swaps, setSwaps] = useState<Swap[]>([]);

  const fetchSwaps = useCallback(async () => {
    try {
      const list = await getAPI().whisperwoofGetMemorySwaps?.();
      setSwaps(Array.isArray(list) ? list : []);
    } catch {
      // Non-critical: the section shows its empty state.
    }
  }, []);

  useEffect(() => {
    fetchSwaps();
  }, [fetchSwaps, refreshKey]);

  useEffect(() => getAPI().onMemorySwapsUpdated?.(fetchSwaps), [fetchSwaps]);

  const handleRemove = async (swap: Swap) => {
    setSwaps((prev) => prev.filter((s) => s.from !== swap.from || s.to !== swap.to));
    try {
      await getAPI().declineMemorySwap?.(swap.from, swap.to);
    } catch {
      fetchSwaps();
    }
  };

  return (
    <div className="px-5 py-4 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Replace size={14} className="text-mando/70" />
          Automatic fixes
        </h3>
        {swaps.length > 0 && (
          <span className="text-xs text-muted-foreground/50">{swaps.length} active</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground/50 mb-3 leading-relaxed">
        Mishearings Memory changes for you before the text is pasted, with every speech engine.
        Stop one and Memory won't offer it again.
      </p>
      <SwapsList swaps={swaps} onRemove={handleRemove} />
    </div>
  );
}
