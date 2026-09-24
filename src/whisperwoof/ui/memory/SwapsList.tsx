/**
 * SwapsList — the mishearings Memory changes for you (approved swaps and
 * alternatives typed into Memory), with a way to stop each one. Pure: data
 * in, callbacks out (SwapsSection fetches and keeps it current).
 */

import { ArrowRight, X } from "lucide-react";

export interface Swap {
  readonly from: string;
  readonly to: string;
}

export function SwapsList({
  swaps,
  onRemove,
}: {
  readonly swaps: readonly Swap[];
  readonly onRemove: (swap: Swap) => void;
}) {
  if (swaps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/50 leading-relaxed">
        None yet. When you fix the same mishearing twice, Memory asks whether to always change it. The
        ones you approve show up here.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle">
      {swaps.map((swap) => (
        <div
          key={`${swap.from}\u0000${swap.to}`}
          className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle last:border-b-0 hover:bg-foreground/[0.03] transition-colors"
        >
          <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground/70 line-through decoration-muted-foreground/30 truncate">
              {swap.from}
            </span>
            <ArrowRight size={12} className="shrink-0 text-mando/70" aria-hidden="true" />
            <span className="font-medium text-foreground truncate">{swap.to}</span>
          </div>
          <button
            type="button"
            aria-label={`Stop changing “${swap.from}” to “${swap.to}”`}
            title="Stop changing this"
            onClick={() => onRemove(swap)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded text-muted-foreground/40 hover:text-destructive transition-all"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
