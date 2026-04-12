import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, Mic, Clipboard, Trash2, Star, Sparkles, Upload, ImageIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../components/lib/utils";
import type { Entry, EntrySource } from "../../core/storage/types";

// WhisperWoof-specific electronAPI methods (exposed in preload.js).
// These augment the global Window.electronAPI declared in src/types/electron.ts.
interface WhisperWoofElectronAPI {
  whisperwoofGetEntries: (limit: number, offset: number) => Promise<Entry[]>;
  whisperwoofSearchEntries: (query: string, limit: number) => Promise<Entry[]>;
  whisperwoofDeleteEntry: (id: string) => Promise<{ success: boolean }>;
  whisperwoofToggleFavorite: (id: string) => Promise<{ success: boolean; isFavorite: boolean }>;
  whisperwoofGetFavorites: (limit: number) => Promise<Entry[]>;
  whisperwoofGetImage: (imagePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
}

function getAPI(): WhisperWoofElectronAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI as WhisperWoofElectronAPI;
}

type SourceFilter = "all" | "voice" | "clipboard" | "favorites";

interface WhisperWoofHistoryProps {
  readonly className?: string;
}

// Helpers (pure, side-effect-free)

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function displayText(entry: Entry): string {
  return entry.polished ?? entry.rawText ?? "";
}

interface ImageMetadata {
  readonly type: "image";
  readonly width: number;
  readonly height: number;
  readonly thumbPath: string;
}

function parseImageMetadata(entry: Entry): ImageMetadata | null {
  try {
    const meta = typeof entry.metadata === "string"
      ? JSON.parse(entry.metadata)
      : entry.metadata;
    if (meta?.type === "image") return meta as ImageMetadata;
  } catch {
    // Malformed metadata — not an image entry
  }
  return null;
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Subcomponents

function SourceIcon({ source }: { readonly source: EntrySource }) {
  if (source === "voice") {
    return <Mic size={14} className="shrink-0 text-amber-500" />;
  }
  if (source === "import") {
    return <Upload size={14} className="shrink-0 text-emerald-500" />;
  }
  return <Clipboard size={14} className="shrink-0 text-muted-foreground" />;
}

function sourceLabel(source: EntrySource): string {
  switch (source) {
    case "voice": return "Voice";
    case "clipboard": return "Clipboard";
    case "import": return "Import";
    case "meeting": return "Meeting";
    default: return source;
  }
}

function sourceBadgeClass(source: EntrySource): string {
  switch (source) {
    case "voice": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "import": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function SourceBadge({ source }: { readonly source: EntrySource }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", sourceBadgeClass(source))}>
      <SourceIcon source={source} />
      {sourceLabel(source)}
    </span>
  );
}

function filterLabel(f: SourceFilter): string {
  switch (f) {
    case "all": return "All";
    case "voice": return "Voice";
    case "clipboard": return "Clipboard";
    case "favorites": return "Favorites";
    default: return f;
  }
}

function FilterChips({
  active,
  onChange,
}: {
  readonly active: SourceFilter;
  readonly onChange: (f: SourceFilter) => void;
}) {
  const filters: readonly SourceFilter[] = ["all", "voice", "clipboard", "favorites"];
  return (
    <div className="flex items-center gap-1">
      {filters.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150",
            active === f
              ? "bg-primary/10 text-primary dark:bg-primary/15"
              : "text-muted-foreground hover:bg-foreground/5 dark:hover:bg-white/5"
          )}
        >
          {f === "favorites" && <Star size={11} className="inline mr-1" />}
          {filterLabel(f)}
        </button>
      ))}
    </div>
  );
}

const EntryRow = React.memo(function EntryRow({
  entry,
  isSelected,
  onSelect,
  onToggleFavorite,
}: {
  readonly entry: Entry;
  readonly isSelected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggleFavorite: (id: string) => void;
}) {
  const text = displayText(entry);
  const isFavorite = entry.favorite === 1;
  const imageMeta = parseImageMetadata(entry);

  return (
    <button
      onClick={() => onSelect(entry.id)}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-md transition-colors duration-150 outline-none",
        "focus-visible:ring-1 focus-visible:ring-primary/30",
        isSelected
          ? "bg-primary/8 dark:bg-primary/12"
          : "hover:bg-foreground/4 dark:hover:bg-white/4"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          {imageMeta ? (
            <ImageIcon size={14} className="shrink-0 text-blue-500" />
          ) : (
            <SourceIcon source={entry.source} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {imageMeta ? (
            <p className="text-sm text-foreground leading-snug truncate">
              Image {imageMeta.width}&times;{imageMeta.height}
            </p>
          ) : (
            <p className="text-sm text-foreground leading-snug truncate">
              {text ? truncate(text, 80) : <span className="italic text-muted-foreground">Empty entry</span>}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-muted-foreground">{relativeTime(entry.createdAt)}</span>
            <SourceBadge source={entry.source} />
            {entry.routedTo && (
              <span className="text-[11px] text-muted-foreground">
                &rarr; {entry.routedTo}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(entry.id);
          }}
          className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-foreground/5 transition-colors"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            size={14}
            className={cn(
              "transition-colors",
              isFavorite
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40 hover:text-amber-400"
            )}
          />
        </button>
      </div>
    </button>
  );
});

function ImagePreview({ imagePath }: { readonly imagePath: string }) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageData(null);
    setLoadError(null);

    getAPI()
      .whisperwoofGetImage(imagePath)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setImageData(result.data);
        } else {
          setLoadError(result.error ?? "Failed to load image");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load image");
      });

    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center p-6 rounded-md bg-muted/50 text-xs text-muted-foreground">
        {loadError}
      </div>
    );
  }

  if (!imageData) {
    return (
      <div className="flex items-center justify-center p-6 rounded-md bg-muted/50 text-xs text-muted-foreground">
        Loading image...
      </div>
    );
  }

  return (
    <img
      src={`data:image/png;base64,${imageData}`}
      alt="Clipboard capture"
      className="max-w-full rounded-md border border-border/20 dark:border-white/6"
    />
  );
}

function EntryDetail({
  entry,
  onDelete,
  onToggleFavorite,
}: {
  readonly entry: Entry;
  readonly onDelete: (id: string) => void;
  readonly onToggleFavorite: (id: string) => void;
}) {
  const hasPolish = entry.polished != null && entry.rawText != null && entry.polished !== entry.rawText;
  const isFavorite = entry.favorite === 1;
  const imageMeta = parseImageMetadata(entry);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <SourceBadge source={entry.source} />
        <span className="text-xs text-muted-foreground">{formatFullTimestamp(entry.createdAt)}</span>
        {entry.hotkeyUsed && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {entry.hotkeyUsed}
          </span>
        )}
        <button
          onClick={() => onToggleFavorite(entry.id)}
          className="ml-auto p-1 rounded hover:bg-foreground/5 transition-colors"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            size={16}
            className={cn(
              "transition-colors",
              isFavorite
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40 hover:text-amber-400"
            )}
          />
        </button>
      </div>

      {/* Image content */}
      {imageMeta && entry.audioPath ? (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ImageIcon size={13} className="text-blue-500" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Image {imageMeta.width}&times;{imageMeta.height}
            </span>
          </div>
          <ImagePreview imagePath={entry.audioPath} />
        </div>
      ) : hasPolish ? (
        <>
          {/* Polished text */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles size={13} className="text-purple-500" />
              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Polished</span>
            </div>
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {entry.polished}
            </div>
          </div>

          {/* Original transcript — always visible, muted */}
          <div>
            <span className="text-[11px] font-medium text-muted-foreground/70">Original transcript</span>
            <div className="mt-1 p-3 rounded-md bg-muted/50 dark:bg-white/5 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {entry.rawText}
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
          {displayText(entry) || <span className="italic text-muted-foreground">No text content</span>}
        </div>
      )}

      {/* Metadata */}
      {entry.routedTo && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Routed to:</span>
          <span>{entry.routedTo}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border/20 dark:border-white/6">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(entry.id)}
          className="gap-1.5"
        >
          <Trash2 size={13} />
          Delete
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-12">
      <Mic size={32} className="text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">
        No entries yet. Hold Fn and speak, or copy something to get started.
      </p>
    </div>
  );
}

function NoSelectionPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      Select an entry to view details
    </div>
  );
}

// Virtual scroll constants
const ROW_HEIGHT = 56;
const BUFFER = 10;
const PAGE_SIZE = 500;
const LOAD_MORE_THRESHOLD = 100; // px from bottom to trigger load-more

// Main component

export default function WhisperWoofHistory({ className }: WhisperWoofHistoryProps) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Virtual scroll state
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const [favoriteEntries, setFavoriteEntries] = useState<readonly Entry[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track container height via ResizeObserver
  useEffect(() => {
    const node = listContainerRef.current;
    if (node == null) return;

    setContainerHeight(node.clientHeight);

    const observer = new ResizeObserver((resizeEntries) => {
      const rect = resizeEntries[0];
      if (rect != null) {
        setContainerHeight(rect.contentRect.height);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fetchEntries = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getAPI().whisperwoofGetEntries(PAGE_SIZE, 0);
      const fetched = data ?? [];
      setEntries(fetched);
      setHasMore(fetched.length >= PAGE_SIZE);
    } catch (err) {
      setError("Failed to load entries. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchFavorites = useCallback(async () => {
    try {
      const data = await getAPI().whisperwoofGetFavorites(PAGE_SIZE);
      setFavoriteEntries(data ?? []);
    } catch {
      // Silently fail — favorites are non-critical
    }
  }, []);

  const loadMoreEntries = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    try {
      setIsLoadingMore(true);
      const data = await getAPI().whisperwoofGetEntries(PAGE_SIZE, entries.length);
      const fetched = data ?? [];
      if (fetched.length === 0) {
        setHasMore(false);
      } else {
        setEntries((prev) => [...prev, ...fetched]);
        setHasMore(fetched.length >= PAGE_SIZE);
      }
    } catch {
      // Silently fail load-more; user can scroll again to retry
    } finally {
      setIsLoadingMore(false);
    }
  }, [entries.length, hasMore, isLoadingMore]);

  const searchEntries = useCallback(async (query: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setHasMore(false); // Search returns all matches; no pagination
      const data = await getAPI().whisperwoofSearchEntries(query, PAGE_SIZE);
      setEntries(data ?? []);
    } catch (err) {
      setError("Search failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchFavorites();
  }, [fetchEntries, fetchFavorites]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    if (searchQuery.trim() === "") {
      fetchEntries();
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchEntries(searchQuery.trim());
    }, 300);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, fetchEntries, searchEntries]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await getAPI().whisperwoofDeleteEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    } catch {
      setError("Failed to delete entry. Please try again.");
    }
  }, []);

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const result = await getAPI().whisperwoofToggleFavorite(id);
      if (!result.success) return;

      const newFavoriteValue = result.isFavorite ? 1 : 0;

      // Update entry in main list (immutable)
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, favorite: newFavoriteValue } : e))
      );

      // Refresh favorites list
      fetchFavorites();
    } catch {
      setError("Failed to toggle favorite. Please try again.");
    }
  }, [fetchFavorites]);

  const filteredEntries = useMemo(() => {
    if (sourceFilter === "favorites") return favoriteEntries;
    if (sourceFilter === "all") return entries;
    return entries.filter((e) => e.source === sourceFilter);
  }, [entries, favoriteEntries, sourceFilter]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((e) => e.id === selectedId) ?? null,
    [filteredEntries, selectedId]
  );

  // Virtual scroll calculations
  const totalHeight = filteredEntries.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIdx = Math.min(
    filteredEntries.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER
  );
  const visibleEntries = filteredEntries.slice(startIdx, endIdx);

  const handleListScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      setScrollTop(target.scrollTop);

      // Trigger load-more when near the bottom
      const distanceFromBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceFromBottom < LOAD_MORE_THRESHOLD && hasMore && !isLoadingMore) {
        loadMoreEntries();
      }
    },
    [hasMore, isLoadingMore, loadMoreEntries]
  );

  return (
    <div className={cn("flex h-full max-w-5xl mx-auto w-full", className)}>
      {/* List panel */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border/15 dark:border-white/6">
        {/* Search */}
        <div className="p-3 pb-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* Filter chips */}
        <div className="px-3 pb-2">
          <FilterChips active={sourceFilter} onChange={setSourceFilter} />
        </div>

        {/* Entry list — virtual scrolled */}
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto px-1.5"
          onScroll={handleListScroll}
        >
          {isLoading && filteredEntries.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-4">
              <p className="text-xs text-destructive">{error}</p>
              <Button variant="outline-flat" size="sm" onClick={fetchEntries} className="mt-2 text-xs">
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && filteredEntries.length === 0 && <EmptyState />}

          {filteredEntries.length > 0 && (
            <div style={{ height: totalHeight, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: startIdx * ROW_HEIGHT,
                  width: "100%",
                }}
              >
                {visibleEntries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    isSelected={entry.id === selectedId}
                    onSelect={setSelectedId}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            </div>
          )}

          {isLoadingMore && (
            <div className="flex items-center justify-center py-3">
              <span className="text-xs text-muted-foreground">Loading more…</span>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {selectedEntry ? (
          <EntryDetail entry={selectedEntry} onDelete={handleDelete} onToggleFavorite={handleToggleFavorite} />
        ) : (
          <NoSelectionPlaceholder />
        )}
      </div>
    </div>
  );
}
