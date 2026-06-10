/**
 * ClipboardTimeline — condensed, card-based timeline of all clipboard activity.
 *
 * Replaces the old Kanban snippet board. Shows every clipboard capture
 * (bf_entries where source = "clipboard") newest-first, grouped by day, with
 * click-to-copy and hover delete. Backed by whisperwoofGetEntriesBySource so
 * old clipboard items aren't buried under voice entries.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Clipboard, Image as ImageIcon, Copy, Trash2, Search, Check, ArrowRightLeft } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import type { Entry } from "../../core/storage/types";

const PAGE_SIZE = 50;

interface ClipboardApi {
  whisperwoofGetEntriesBySource?: (source: string, limit: number, offset: number) => Promise<Entry[]>;
  whisperwoofDeleteEntry?: (id: string) => Promise<void>;
  writeClipboard?: (text: string) => Promise<unknown>;
}
function getApi(): ClipboardApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as unknown as { electronAPI?: ClipboardApi }).electronAPI) ?? {};
}

function isImageEntry(e: Entry): boolean {
  return (e.metadata as { type?: string })?.type === "image";
}
function entryText(e: Entry): string {
  return e.polished ?? e.rawText ?? "";
}
function charCount(e: Entry): number {
  return entryText(e).length;
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

interface CardProps {
  readonly entry: Entry;
  readonly copied: boolean;
  readonly onCopy: (entry: Entry) => void;
  readonly onDelete: (id: string) => void;
}

function ClipboardCard({ entry, copied, onCopy, onDelete }: CardProps) {
  const image = isImageEntry(entry);
  const text = entryText(entry);
  const meta = entry.metadata as { width?: number; height?: number };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2.5 rounded-lg px-3 py-2 cursor-pointer select-none",
        "border border-border/30 dark:border-white/5 bg-card/40 dark:bg-card/50",
        "hover:border-border/70 hover:bg-card/80 transition-colors"
      )}
      onClick={() => !image && onCopy(entry)}
      title={image ? "Image capture" : "Click to copy"}
    >
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-foreground/[0.04] dark:bg-white/[0.05] flex items-center justify-center">
        {image ? (
          <ImageIcon size={13} className="text-muted-foreground/70" />
        ) : (
          <Clipboard size={13} className="text-muted-foreground/70" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs leading-snug text-foreground/90",
            image ? "" : "line-clamp-2 whitespace-pre-wrap break-words font-[450]"
          )}
        >
          {image ? `Image · ${meta.width ?? "?"}×${meta.height ?? "?"}` : text}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
          <span>{timeOfDay(entry.createdAt)}</span>
          {!image && <span>· {charCount(entry).toLocaleString()} chars</span>}
          {entry.routedTo && (
            <span className="inline-flex items-center gap-0.5 text-primary/70">
              <ArrowRightLeft size={9} /> {entry.routedTo}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!image && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy(entry);
            }}
            className="p-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5"
            title="Copy"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
          className="p-1.5 rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {copied && (
        <span className="absolute right-2 top-2 text-[10px] font-medium text-emerald-500">Copied</span>
      )}
    </div>
  );
}

export default function ClipboardTimeline() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    try {
      const api = getApi();
      if (!api.whisperwoofGetEntriesBySource) {
        setHasMore(false);
        return;
      }
      const batch = await api.whisperwoofGetEntriesBySource("clipboard", PAGE_SIZE, offsetRef.current);
      offsetRef.current += batch.length;
      setEntries((prev) => [...prev, ...batch]);
      if (batch.length < PAGE_SIZE) setHasMore(false);
    } catch {
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = useCallback(async (entry: Entry) => {
    const text = entryText(entry);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await getApi().writeClipboard?.(text);
    }
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await getApi().whisperwoofDeleteEntry?.(id);
    } catch {
      /* optimistic — best effort */
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => entryText(e).toLowerCase().includes(q));
  }, [entries, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const k = dayBucket(e.createdAt);
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3">
          <h1 className="text-base font-semibold text-foreground">Clipboard</h1>
          <p className="text-xs text-muted-foreground">Everything you've copied, newest first.</p>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clipboard…"
            className="w-full h-9 pl-9 pr-3 rounded-lg text-sm bg-card/50 dark:bg-card/60 border border-border/40 focus:border-primary/50 focus:outline-none text-foreground placeholder:text-muted-foreground/50"
          />
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground/50 py-10 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-card/40 py-16 text-center">
            <Clipboard size={28} className="mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-foreground/70">
              {query ? "No matches." : "No clipboard activity yet."}
            </p>
            {!query && (
              <p className="text-xs text-muted-foreground/50 mt-1">
                Copy anything and it shows up here.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([day, items]) => (
              <div key={day}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {day}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((entry) => (
                    <ClipboardCard
                      key={entry.id}
                      entry={entry}
                      copied={copiedId === entry.id}
                      onCopy={handleCopy}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}

            {hasMore && !query && (
              <button
                onClick={loadMore}
                className="w-full py-2 text-xs text-primary/80 hover:text-primary border border-border/40 rounded-lg hover:bg-card/60 transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
