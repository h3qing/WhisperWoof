import { useState, useEffect, useCallback, useRef } from "react";
import { Clipboard, ArrowRight } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import type { Entry } from "../../core/storage/types";
import { relativeTime, truncateText } from "../shared/format";

const MAX_VISIBLE = 5;
const REFRESH_INTERVAL_MS = 5_000;
const FETCH_LIMIT = 20;

function displayLabel(entry: Entry): string {
  const meta = entry.metadata as Record<string, unknown>;
  if (meta?.type === "image") return "[Image]";
  const text = entry.polished ?? entry.rawText ?? "";
  return text.length > 0 ? truncateText(text, 100) : "[Empty]";
}

interface ClipboardHistoryProps {
  readonly onNavigateToHistory?: () => void;
}

export default function ClipboardHistory({ onNavigateToHistory }: ClipboardHistoryProps) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchClipboardEntries = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).electronAPI;
      if (api?.whisperwoofGetEntries == null) return;

      const raw: Entry[] = await api.whisperwoofGetEntries(FETCH_LIMIT, 0);
      const clipboardOnly = (raw ?? []).filter((e) => e.source === "clipboard");
      setEntries(clipboardOnly.slice(0, MAX_VISIBLE));
      setError(null);
    } catch {
      setError("Unable to load clipboard entries.");
    }
  }, []);

  useEffect(() => {
    fetchClipboardEntries();

    intervalRef.current = setInterval(fetchClipboardEntries, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchClipboardEntries]);

  if (error != null) {
    return (
      <p className="text-xs text-muted-foreground/60 italic py-2">{error}</p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/50 py-2">
        No clipboard captures yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex items-start gap-2 px-3 py-2 rounded-lg",
            "bg-card shadow-card"
          )}
        >
          <Clipboard size={13} className="shrink-0 mt-0.5 text-muted-foreground/50" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground leading-snug truncate">
              {displayLabel(entry)}
            </p>
            <span className="text-[11px] text-muted-foreground/60">
              {relativeTime(entry.createdAt)}
            </span>
          </div>
        </div>
      ))}

      {onNavigateToHistory != null && (
        <button
          onClick={onNavigateToHistory}
          className="flex items-center gap-1 mt-1 text-xs text-primary/80 hover:text-primary transition-colors"
        >
          View all in History
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}
