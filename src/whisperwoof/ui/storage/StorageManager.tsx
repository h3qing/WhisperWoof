/**
 * StorageManager — Disk usage, batch operations, export, cleanup
 *
 * Shows disk usage breakdown, lets users browse entries by size/type,
 * select and batch delete, export as JSON, clean up orphaned files.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { formatBytes, relativeTime } from "../shared/format";
import {
  HardDrive,
  Trash2,
  Download,
  Image,
  Mic,
  Clipboard,
  FileText,
  Check,
  Square,
  CheckSquare,
  Filter,
  ArrowUpDown,
  Sparkles,
  AlertTriangle,
  Play,
  StopCircle,
  X,
} from "lucide-react";
import { cn } from "../../../components/lib/utils";
import {
  EXPORT_MIME_TYPES,
  exportFilename,
  formatEntries,
  type ExportFormat,
  type ExportableEntry,
} from "./exportFormats";

// --- Types ---

interface StorageUsage {
  database: { bytes: number; label: string };
  images: { bytes: number; files: number; label: string };
  audio: { bytes: number; files: number; label: string };
  notes: { bytes: number; files: number; label: string };
  total: number;
  entryCounts: { voice: number; clipboard: number; meeting: number; import: number; total: number };
  imageEntryCount: number;
}

interface StorageEntry {
  id: string;
  createdAt: string;
  source: string;
  text: string;
  textLength: number;
  isImage: boolean;
  thumbPath: string | null;
  filePath: string | null;
  fileSize: number;
  favorite: number;
}

interface StorageAPI {
  whisperwoofStorageUsage?: () => Promise<StorageUsage>;
  whisperwoofStorageEntries?: (opts: Record<string, unknown>) => Promise<StorageEntry[]>;
  whisperwoofStorageDeleteBatch?: (ids: string[]) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageDeleteBySource?: (source: string) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageDeleteOlder?: (days: number) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageExport?: (ids?: string[]) => Promise<unknown[]>;
  whisperwoofStorageCleanupOrphans?: () => Promise<{ removed: number; bytes: number }>;
}

function getAPI(): StorageAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

const SOURCE_ICONS: Record<string, typeof Mic> = {
  voice: Mic,
  clipboard: Clipboard,
  meeting: FileText,
  import: Download,
};

// --- Usage Bar ---

function UsageBar({ usage }: { usage: StorageUsage }) {
  const segments = [
    { label: "Database", bytes: usage.database.bytes, color: "#A06A3C" },
    { label: "Images", bytes: usage.images.bytes, color: "#60A5FA" },
    { label: "Audio", bytes: usage.audio.bytes, color: "#4ADE80" },
    { label: "Notes", bytes: usage.notes.bytes, color: "#F472B6" },
  ].filter((s) => s.bytes > 0);

  const total = Math.max(usage.total, 1);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-foreground">{formatBytes(usage.total)}</span>
        <span className="text-[10px] text-muted-foreground/50">{usage.entryCounts.total} entries</span>
      </div>

      {/* Bar */}
      <div className="h-2.5 rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] overflow-hidden flex">
        {segments.map((seg) => (
          <div
            key={seg.label}
            style={{ width: `${(seg.bytes / total) * 100}%`, backgroundColor: seg.color }}
            className="h-full first:rounded-l-full last:rounded-r-full"
            title={`${seg.label}: ${formatBytes(seg.bytes)}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
            {seg.label}: {formatBytes(seg.bytes)}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Main ---

export default function StorageManager() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "size">("date");
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchUsage = useCallback(async () => {
    const api = getAPI();
    if (api.whisperwoofStorageUsage) {
      const data = await api.whisperwoofStorageUsage();
      setUsage(data);
    }
  }, []);

  const fetchEntries = useCallback(async () => {
    const api = getAPI();
    if (api.whisperwoofStorageEntries) {
      const data = await api.whisperwoofStorageEntries({
        sortBy,
        order: "desc",
        source: filterSource,
        limit: 200,
      });
      setEntries(data);
    }
  }, [sortBy, filterSource]);

  useEffect(() => { fetchUsage(); fetchEntries(); }, [fetchUsage, fetchEntries]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const showResult = (msg: string) => {
    setActionResult(msg);
    setTimeout(() => setActionResult(null), 4000);
  };

  const confirmThen = (message: string, action: () => void) => {
    setConfirmAction({ message, onConfirm: action });
  };

  const doDeleteSelected = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    const api = getAPI();
    if (api.whisperwoofStorageDeleteBatch) {
      const result = await api.whisperwoofStorageDeleteBatch([...selected]);
      showResult(`Deleted ${result.deleted} entries, removed ${result.filesRemoved} files`);
    }
    setSelected(new Set());
    await fetchUsage();
    await fetchEntries();
    setLoading(false);
  };

  const handleDeleteSelected = () => {
    if (selected.size === 0) return;
    confirmThen(`Delete ${selected.size} selected entries? Associated files will also be removed. This cannot be undone.`, doDeleteSelected);
  };

  // Audio playback
  const handlePlayAudio = (filePath: string) => {
    if (playingAudio === filePath) {
      // Stop
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingAudio(null);
      return;
    }
    // Stop any existing playback
    audioRef.current?.pause();
    const audio = new Audio(`file://${filePath}`);
    audio.onended = () => { setPlayingAudio(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingAudio(null); audioRef.current = null; };
    audio.play().catch(() => setPlayingAudio(null));
    audioRef.current = audio;
    setPlayingAudio(filePath);
  };

  const handleExportSelected = async () => {
    const api = getAPI();
    if (!api.whisperwoofStorageExport) return;
    const ids = selected.size > 0 ? [...selected] : undefined;
    const data = (await api.whisperwoofStorageExport(ids)) as ExportableEntry[];
    const body = formatEntries(data, exportFormat);
    const blob = new Blob([body], { type: EXPORT_MIME_TYPES[exportFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(exportFormat);
    a.click();
    URL.revokeObjectURL(url);
    showResult(`Exported ${data.length} entries (${exportFormat.toUpperCase()})`);
  };

  const handleExportAndDelete = () => {
    confirmThen(`Export ${selected.size > 0 ? selected.size + " selected" : "all"} entries as JSON, then delete them? This cannot be undone.`, async () => {
      await handleExportSelected();
      await doDeleteSelected();
    });
  };

  const handleDeleteOlder = (days: number) => {
    confirmThen(`Delete all entries older than ${days} days? Favorited entries will be preserved. This cannot be undone.`, async () => {
      setLoading(true);
      const api = getAPI();
      if (api.whisperwoofStorageDeleteOlder) {
        const result = await api.whisperwoofStorageDeleteOlder(days);
        showResult(`Deleted ${result.deleted} entries older than ${days} days (${result.filesRemoved} files removed)`);
      }
      await fetchUsage();
      await fetchEntries();
      setLoading(false);
    });
  };

  const handleCleanupOrphans = async () => {
    setLoading(true);
    const api = getAPI();
    if (api.whisperwoofStorageCleanupOrphans) {
      const result = await api.whisperwoofStorageCleanupOrphans();
      showResult(`Cleaned up ${result.removed} orphaned files (${formatBytes(result.bytes)} freed)`);
    }
    await fetchUsage();
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border/30 dark:border-white/10 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-foreground leading-relaxed">{confirmAction.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border/20 dark:border-white/8 hover:bg-foreground/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { confirmAction.onConfirm(); setConfirmAction(null); }}
                className="px-4 py-1.5 text-xs text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-border/15 dark:border-white/6 shrink-0">
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-primary/70" />
          <h2 className="text-sm font-semibold text-foreground">Storage Manager</h2>
        </div>
        <p className="text-[11px] text-muted-foreground/50 mt-0.5">
          Manage disk usage, batch delete, export your data
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Disk Usage */}
        {usage && <UsageBar usage={usage} />}

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCleanupOrphans}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/20 dark:border-white/6 text-muted-foreground/70 hover:text-foreground hover:border-border/40 transition-all disabled:opacity-50"
          >
            <Sparkles size={11} /> Clean orphaned files
          </button>
          <button
            onClick={() => handleDeleteOlder(30)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/20 dark:border-white/6 text-muted-foreground/70 hover:text-foreground hover:border-border/40 transition-all disabled:opacity-50"
          >
            <Trash2 size={11} /> Delete older than 30 days
          </button>
          <button
            onClick={() => handleDeleteOlder(90)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/20 dark:border-white/6 text-muted-foreground/70 hover:text-foreground hover:border-border/40 transition-all disabled:opacity-50"
          >
            <Trash2 size={11} /> Delete older than 90 days
          </button>
          <div className="flex items-center gap-1">
            <select
              aria-label="Export format"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="text-xs px-2 py-1.5 rounded-md border border-border/20 dark:border-white/6 bg-transparent text-muted-foreground/70 hover:text-foreground transition-all outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="json">JSON</option>
              <option value="txt">TXT</option>
            </select>
            <button
              onClick={handleExportSelected}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/20 dark:border-white/6 text-muted-foreground/70 hover:text-foreground hover:border-border/40 transition-all"
            >
              <Download size={11} /> Export {selected.size > 0 ? `${selected.size} selected` : "all"}
            </button>
          </div>
        </div>

        {/* Notification */}
        {actionResult && (
          <div className="flex items-center gap-2 text-xs text-emerald-500/80 bg-emerald-500/5 px-3 py-2 rounded-md">
            <Check size={12} /> {actionResult}
          </div>
        )}

        {/* Filters + Sort */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Filter size={10} className="text-muted-foreground/40" />
            {["all", "voice", "clipboard", "meeting", "import"].map((src) => (
              <button
                key={src}
                onClick={() => setFilterSource(src === "all" ? null : src)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded transition-colors",
                  (src === "all" && !filterSource) || filterSource === src
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/50 hover:text-foreground"
                )}
              >
                {src}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSortBy(sortBy === "date" ? "size" : "date")}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground ml-auto"
          >
            <ArrowUpDown size={10} /> {sortBy === "date" ? "Sort by size" : "Sort by date"}
          </button>
        </div>

        {/* Batch Actions Bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-foreground/[0.03] dark:bg-white/[0.03] rounded-md px-3 py-2">
            <span className="text-xs text-foreground/70">{selected.size} selected</span>
            <div className="ml-auto flex gap-2">
              <button onClick={handleExportAndDelete} className="text-[11px] text-amber-500 hover:text-amber-400 flex items-center gap-1">
                <Download size={10} /> Export & Delete
              </button>
              <button onClick={handleDeleteSelected} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1">
                <Trash2 size={10} /> Delete
              </button>
            </div>
          </div>
        )}

        {/* Entry List */}
        <div className="space-y-1">
          {/* Select All */}
          <button onClick={selectAll} className="flex items-center gap-2 text-[10px] text-muted-foreground/40 hover:text-foreground px-1 py-1">
            {selected.size === entries.length && entries.length > 0 ? <CheckSquare size={12} /> : <Square size={12} />}
            {selected.size === entries.length && entries.length > 0 ? "Deselect all" : "Select all"}
          </button>

          {entries.map((entry) => {
            const Icon = SOURCE_ICONS[entry.source] || FileText;
            const isSelected = selected.has(entry.id);
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors cursor-pointer",
                  isSelected
                    ? "bg-primary/[0.06] border border-primary/20"
                    : "hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02] border border-transparent"
                )}
                onClick={() => toggleSelect(entry.id)}
              >
                {/* Checkbox */}
                <span className="shrink-0 text-muted-foreground/30">
                  {isSelected ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} />}
                </span>

                {/* Source icon */}
                <Icon size={12} className="shrink-0 text-muted-foreground/40" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground/80 truncate">
                    {entry.isImage ? "📷 Image" : entry.text || "(empty)"}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40 mt-0.5">
                    <span>{relativeTime(entry.createdAt)}</span>
                    <span>{entry.textLength > 0 ? `${entry.textLength} chars` : ""}</span>
                    {entry.fileSize > 0 && <span className="text-amber-500/50">{formatBytes(entry.fileSize)}</span>}
                    {entry.favorite === 1 && <span className="text-amber-400">★</span>}
                  </div>
                </div>

                {/* Play button for audio files */}
                {entry.filePath && entry.source === "voice" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePlayAudio(entry.filePath!); }}
                    className="p-1 rounded hover:bg-foreground/8 dark:hover:bg-white/8 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                    title={playingAudio === entry.filePath ? "Stop" : "Play recording"}
                  >
                    {playingAudio === entry.filePath ? <StopCircle size={14} className="text-amber-500" /> : <Play size={14} />}
                  </button>
                )}

                {/* Size badge for large items */}
                {entry.fileSize > 100000 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500/60 shrink-0">
                    {formatBytes(entry.fileSize)}
                  </span>
                )}
              </div>
            );
          })}

          {entries.length === 0 && (
            <p className="text-xs text-muted-foreground/40 text-center py-8">No entries found</p>
          )}
        </div>
      </div>
    </div>
  );
}
