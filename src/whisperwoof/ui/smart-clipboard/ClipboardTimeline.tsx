/**
 * Clipboard — everything you've copied, text on the left and images on the
 * right. Click an item to copy it again (images go back as the image itself,
 * not a file name). Hover for: save as a note, pin (kept by clean-up), remove.
 * The top line says what's kept and what images cost on disk; the controls
 * next to search set how long history is kept, how much space images may
 * use, and clear things in bulk. Backed by bridge/clipboard-store.js; items
 * are addressed by id.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Check,
  ChevronDown,
  FilePlus2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Maximize2,
  Pin,
  PinOff,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../../../components/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  IMAGE_CAP_CHOICES,
  KEEP_DAYS_CHOICES,
  KEEP_FILES_WARNING,
  clearOptions,
  clearQuestion,
  clipboardHeadline,
  fileBadge,
  formatBytes,
  imageCaption,
  relativeTime,
  type ClearChoice,
  type ClipboardItem,
  type ClipboardKind,
  type ClipboardRetention,
  type ClipboardSummary,
} from "./clipboard-view";

const PAGE = { text: 60, image: 36, file: 40 } as const;

type Result<T = object> = Promise<({ success: boolean; error?: string } & Partial<T>) | undefined>;

interface ClipboardApi {
  whisperwoofClipboardList?: (o: {
    kind: ClipboardKind;
    limit: number;
    offset: number;
    query: string;
  }) => Result<{ items: ClipboardItem[] }>;
  whisperwoofClipboardSummary?: () => Result<ClipboardSummary>;
  whisperwoofClipboardCopy?: (id: string) => Result;
  whisperwoofClipboardPreview?: (id: string, o?: { size: "thumb" | "large" }) => Result<{ data: string; mime: string }>;
  whisperwoofClipboardToNote?: (id: string) => Result<{ name: string }>;
  whisperwoofClipboardRemove?: (ids: string[]) => Result;
  whisperwoofClipboardClear?: (o: { kind: string; olderThanDays: number }) => Result<{ deleted: number }>;
  whisperwoofClipboardPin?: (id: string, pinned: boolean) => Result;
  whisperwoofClipboardSetRetention?: (r: ClipboardRetention) => Result<{ deleted: number }>;
  whisperwoofClipboardSetCapture?: (c: { keepFiles: boolean }) => Result;
  whisperwoofClipboardReveal?: (id: string) => Result;
  onClipboardChanged?: (cb: () => void) => () => void;
  whisperwoofOpenVoiceNote?: (name: string | null) => Promise<unknown>;
}
const api = (): ClipboardApi => (window as unknown as { electronAPI?: ClipboardApi }).electronAPI ?? {};

interface Notice {
  readonly text: string;
  readonly tone: "info" | "error";
  readonly noteName?: string;
}

/** One column's items, paged; reloads keep however many are already shown. */
function useColumn(kind: ClipboardKind, query: string) {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const shown = useRef(0);

  const fetchItems = useCallback(
    async (offset: number, limit: number) => {
      const res = await api().whisperwoofClipboardList?.({ kind, limit, offset, query });
      return res?.success ? (res.items ?? []) : [];
    },
    [kind, query]
  );

  const reload = useCallback(async () => {
    const limit = Math.max(shown.current, PAGE[kind]);
    const next = await fetchItems(0, limit);
    shown.current = next.length;
    setItems(next);
    setHasMore(next.length === limit);
    setLoaded(true);
  }, [fetchItems, kind]);

  const loadMore = useCallback(async () => {
    const next = await fetchItems(shown.current, PAGE[kind]);
    shown.current += next.length;
    setItems((prev) => [...prev, ...next]);
    setHasMore(next.length === PAGE[kind]);
  }, [fetchItems, kind]);

  useEffect(() => {
    shown.current = 0;
    void reload();
  }, [reload]);

  return { items, setItems, hasMore, loaded, reload, loadMore };
}

function ActionButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly danger?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-foreground/[0.06] hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

interface ItemActions {
  readonly onCopy: (item: ClipboardItem) => void;
  readonly onNote: (item: ClipboardItem) => void;
  readonly onPin: (item: ClipboardItem) => void;
  readonly onRemove: (item: ClipboardItem) => void;
}

function ItemButtons({ item, onNote, onPin, onRemove }: { readonly item: ClipboardItem } & Omit<ItemActions, "onCopy">) {
  return (
    <>
      <ActionButton label="Save as a note" onClick={() => onNote(item)}>
        <FilePlus2 size={14} />
      </ActionButton>
      <ActionButton label={item.pinned ? "Unpin" : "Pin (clean-up keeps it)"} onClick={() => onPin(item)}>
        {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </ActionButton>
      <ActionButton label="Remove" danger onClick={() => onRemove(item)}>
        <Trash2 size={14} />
      </ActionButton>
    </>
  );
}

function TextRow({ item, copied, ...actions }: { readonly item: ClipboardItem; readonly copied: boolean } & ItemActions) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => actions.onCopy(item)}
        className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:bg-surface-3"
      >
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">{item.text}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.pinned && <Pin size={10} className="text-primary" aria-label="Pinned" />}
          {item.sourceApp && <span className="truncate">{item.sourceApp}</span>}
          {item.sourceApp && <span aria-hidden="true">·</span>}
          <span className="shrink-0">{relativeTime(item.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">{item.text.length.toLocaleString("en-US")} characters</span>
        </p>
      </button>
      {/* On the meta line's right: short, so it rarely covers text. */}
      <div
        className={cn(
          "absolute bottom-1.5 right-2 flex items-center gap-0.5 rounded-full bg-card px-0.5 shadow-card transition-opacity",
          copied ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        )}
      >
        {copied ? (
          <span className="flex h-7 items-center gap-1 px-2 text-xs font-medium text-success">
            <Check size={13} aria-hidden="true" /> Copied
          </span>
        ) : (
          <ItemButtons item={item} {...actions} />
        )}
      </div>
    </li>
  );
}

/** A preview loaded by id when the tile scrolls into view. */
function Preview({ id, size = "thumb", className }: { readonly id: string; readonly size?: "thumb" | "large"; readonly className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api()
        .whisperwoofClipboardPreview?.(id, { size })
        .then((res) => {
          if (cancelled) return;
          if (res?.success && res.data) setSrc(`data:${res.mime ?? "image/png"};base64,${res.data}`);
          else setFailed(true);
        })
        .catch(() => !cancelled && setFailed(true));
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [id, size]);

  return (
    <div ref={ref} className={cn("flex items-center justify-center bg-surface-1", className)}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <ImageIcon size={18} className={cn("text-muted-foreground/60", failed ? "" : "animate-pulse")} aria-hidden="true" />
      )}
    </div>
  );
}

function ImageTile({
  item,
  copied,
  onOpen,
  ...actions
}: { readonly item: ClipboardItem; readonly copied: boolean; readonly onOpen: (item: ClipboardItem) => void } & ItemActions) {
  const caption = imageCaption(item);
  return (
    <li className="group relative min-w-0">
      <button
        type="button"
        onClick={() => actions.onCopy(item)}
        aria-label={`Copy image ${caption}`}
        className="block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Preview id={item.id} className="aspect-[4/3] w-full" />
      </button>
      <div
        className={cn(
          "absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-card px-0.5 shadow-card transition-opacity",
          copied ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        )}
      >
        {copied ? (
          <span className="flex h-7 items-center gap-1 px-2 text-xs font-medium text-success">
            <Check size={13} aria-hidden="true" /> Copied
          </span>
        ) : (
          <>
            <ActionButton label="Look closer" onClick={() => onOpen(item)}>
              <Maximize2 size={13} />
            </ActionButton>
            <ItemButtons item={item} {...actions} />
          </>
        )}
      </div>
      <p className="mt-1 flex items-center gap-1 px-0.5 text-xs text-foreground/85">
        {item.pinned && <Pin size={10} className="shrink-0 text-primary" aria-label="Pinned" />}
        <span className="truncate" title={caption}>
          {caption}
        </span>
      </p>
      <p className="truncate px-0.5 text-[11px] text-muted-foreground">
        {[item.sourceApp, relativeTime(item.createdAt)].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

function FileRow({
  item,
  copied,
  onReveal,
  ...actions
}: { readonly item: ClipboardItem; readonly copied: boolean; readonly onReveal: (item: ClipboardItem) => void } & ItemActions) {
  const name = item.fileName ?? "File";
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => actions.onCopy(item)}
        aria-label={`Copy file ${name}`}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:bg-surface-3"
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-1 text-muted-foreground">
          <FileText size={16} aria-hidden="true" />
          <span className="absolute -bottom-1 rounded-full bg-primary px-1 text-[8px] font-bold leading-[12px] text-primary-foreground">
            {fileBadge(item.fileName)}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground" title={name}>
            {item.pinned && <Pin size={10} className="mr-1 inline text-primary" aria-label="Pinned" />}
            {name}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {[item.bytes != null ? formatBytes(item.bytes) : null, item.sourceApp, relativeTime(item.createdAt)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>
      <div
        className={cn(
          "absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-card px-0.5 shadow-card transition-opacity",
          copied ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        )}
      >
        {copied ? (
          <span className="flex h-7 items-center gap-1 px-2 text-xs font-medium text-success">
            <Check size={13} aria-hidden="true" /> Copied
          </span>
        ) : (
          <>
            <ActionButton label="Show in Finder" onClick={() => onReveal(item)}>
              <FolderOpen size={14} />
            </ActionButton>
            <ItemButtons item={item} {...actions} />
          </>
        )}
      </div>
    </li>
  );
}

function Lightbox({ item, onClose, ...actions }: { readonly item: ClipboardItem; readonly onClose: () => void } & ItemActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={imageCaption(item)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-sheet)] bg-card shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {imageCaption(item)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {/* The size is already the caption when there's no file name. */}
              {[item.fileName && item.width && item.height ? `${item.width}×${item.height}` : null, item.sourceApp, relativeTime(item.createdAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          <button
            type="button"
            onClick={() => actions.onCopy(item)}
            className="press rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold text-primary-foreground"
          >
            Copy image
          </button>
          <ItemButtons item={item} onNote={actions.onNote} onPin={actions.onPin} onRemove={(i) => { actions.onRemove(i); onClose(); }} />
          <ActionButton label="Close" onClick={onClose}>
            <X size={15} />
          </ActionButton>
        </div>
        <Preview id={item.id} size="large" className="mx-3 mb-3 min-h-0 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  children,
  empty,
  showEmpty,
  hasMore,
  onMore,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
  readonly empty: string;
  readonly showEmpty: boolean;
  readonly hasMore: boolean;
  readonly onMore: () => void;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-[var(--radius-sheet)] bg-card shadow-card">
      <div className="flex items-baseline justify-between px-4 pb-1 pt-3.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString("en-US")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {showEmpty ? <p className="px-3 py-10 text-center text-xs text-muted-foreground">{empty}</p> : children}
        {hasMore && (
          <button
            type="button"
            onClick={onMore}
            className="mx-auto mt-2 block rounded-full px-3 py-1 text-xs text-primary transition-colors hover:bg-foreground/[0.05]"
          >
            Show more
          </button>
        )}
      </div>
    </section>
  );
}

const selectClass = "h-8 rounded-full px-3 text-xs gap-1.5 [&>svg]:h-3 [&>svg]:w-3";

export default function ClipboardTimeline() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [summary, setSummary] = useState<ClipboardSummary | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingClear, setPendingClear] = useState<ClearChoice | null>(null);
  const [askKeepFiles, setAskKeepFiles] = useState(false);
  const [open, setOpen] = useState<ClipboardItem | null>(null);
  const text = useColumn("text", debounced);
  const images = useColumn("image", debounced);
  const files = useColumn("file", debounced);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  const refreshSummary = useCallback(async () => {
    const res = await api().whisperwoofClipboardSummary?.();
    if (res?.success) setSummary(res as unknown as ClipboardSummary);
  }, []);

  const { reload: reloadText } = text;
  const { reload: reloadImages } = images;
  const { reload: reloadFiles } = files;
  const refreshAll = useCallback(() => {
    void reloadText();
    void reloadImages();
    void reloadFiles();
    void refreshSummary();
  }, [reloadText, reloadImages, reloadFiles, refreshSummary]);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  // New copies show up while the view is open.
  useEffect(() => {
    let timer: number | undefined;
    const off = api().onClipboardChanged?.(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshAll, 250);
    });
    return () => {
      window.clearTimeout(timer);
      off?.();
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), notice.noteName ? 6000 : 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const fail = (error?: string) => setNotice({ text: error ?? "Something went wrong.", tone: "error" });

  const onCopy = useCallback(async (item: ClipboardItem) => {
    const res = await api().whisperwoofClipboardCopy?.(item.id);
    if (!res?.success) return fail(res?.error);
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1400);
  }, []);

  const onNote = useCallback(async (item: ClipboardItem) => {
    const res = await api().whisperwoofClipboardToNote?.(item.id);
    if (!res?.success) return fail(res?.error);
    setNotice({ text: "Saved as a note.", tone: "info", noteName: res.name });
  }, []);

  const onPin = useCallback(async (item: ClipboardItem) => {
    const res = await api().whisperwoofClipboardPin?.(item.id, !item.pinned);
    if (!res?.success) fail(res?.error);
  }, []);

  const onRemove = useCallback(
    async (item: ClipboardItem) => {
      const column = item.kind === "image" ? images : item.kind === "file" ? files : text;
      column.setItems((prev) => prev.filter((i) => i.id !== item.id));
      const res = await api().whisperwoofClipboardRemove?.([item.id]);
      if (!res?.success) fail(res?.error);
    },
    [images, files, text]
  );

  const onReveal = useCallback(async (item: ClipboardItem) => {
    const res = await api().whisperwoofClipboardReveal?.(item.id);
    if (!res?.success) fail(res?.error);
  }, []);

  const keepFiles = summary?.capture?.keepFiles ?? false;
  const setKeepFiles = async (on: boolean) => {
    setAskKeepFiles(false);
    const res = await api().whisperwoofClipboardSetCapture?.({ keepFiles: on });
    if (!res?.success) return fail(res?.error);
    setNotice({
      text: on
        ? "Copied files are kept from now on."
        : "New copied files keep only their name. Files already kept stay until you remove them.",
      tone: "info",
    });
    void refreshSummary();
  };

  const confirmClear = async () => {
    if (!pendingClear) return;
    const res = await api().whisperwoofClipboardClear?.(clearOptions(pendingClear));
    setPendingClear(null);
    if (!res?.success) return fail(res?.error);
    setNotice({ text: `Removed ${(res.deleted ?? 0).toLocaleString("en-US")} items. Pinned items stay.`, tone: "info" });
  };

  const setRetention = async (next: Partial<ClipboardRetention>) => {
    if (!summary) return;
    const res = await api().whisperwoofClipboardSetRetention?.({ ...summary.retention, ...next });
    if (!res?.success) return fail(res?.error);
    if (res.deleted) setNotice({ text: `Cleaned up ${res.deleted.toLocaleString("en-US")} items.`, tone: "info" });
    void refreshSummary();
  };

  const actions: ItemActions = { onCopy, onNote, onPin, onRemove };
  const searching = debounced.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">
          {summary ? clipboardHeadline(summary) : " "}
        </p>
        {summary && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Keep
              <Select value={String(summary.retention.keepDays)} onValueChange={(v) => setRetention({ keepDays: Number(v) })}>
                <SelectTrigger className={cn(selectClass, "w-[96px]")} aria-label="Keep clipboard history for">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEEP_DAYS_CHOICES.map((c) => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {keepFiles || (summary.fileCount ?? 0) > 0 ? "Images & files up to" : "Images up to"}
              <Select value={String(summary.retention.maxImageMB)} onValueChange={(v) => setRetention({ maxImageMB: Number(v) })}>
                <SelectTrigger className={cn(selectClass, "w-[100px]")} aria-label="Space images and files may use">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_CAP_CHOICES.map((c) => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text and file names"
            aria-label="Search clipboard"
            className="h-8 w-full rounded-full bg-card pl-8 pr-3 text-sm text-foreground shadow-card placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={keepFiles}
          onClick={() => (keepFiles ? setKeepFiles(false) : setAskKeepFiles(true))}
          title="PDFs, documents and other files you copy"
          className="press flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs font-medium text-foreground shadow-card hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <FileText size={13} aria-hidden="true" />
          Keep copied files
          <span
            aria-hidden="true"
            className={cn(
              "relative h-4 w-7 rounded-full transition-colors",
              keepFiles ? "bg-primary/90" : "bg-foreground/15"
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 size-3 rounded-full bg-card shadow-sm transition-transform",
                keepFiles ? "translate-x-3" : "translate-x-0"
              )}
            />
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="press flex h-8 items-center gap-1 rounded-full bg-card px-3 text-xs font-medium text-foreground shadow-card hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Trash2 size={13} aria-hidden="true" /> Clear
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setPendingClear("text")}>All text</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPendingClear("image")}>All images</DropdownMenuItem>
            {(summary?.fileCount ?? 0) > 0 && (
              <DropdownMenuItem onSelect={() => setPendingClear("file")}>All files</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setPendingClear("older")}>Older than a week</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPendingClear("all")} className="text-destructive focus:text-destructive">
              Everything
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {askKeepFiles && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-1 px-3 py-2 text-sm">
          <span className="flex-1 text-foreground">{KEEP_FILES_WARNING}</span>
          <button
            type="button"
            onClick={() => setAskKeepFiles(false)}
            className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setKeepFiles(true)}
            className="press rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold text-primary-foreground"
          >
            Keep files
          </button>
        </div>
      )}

      {pendingClear && summary && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-1 px-3 py-2 text-sm">
          <span className="flex-1 text-foreground">
            {clearQuestion(pendingClear, summary)} <span className="text-muted-foreground">Pinned items stay.</span>
          </span>
          <button type="button" onClick={() => setPendingClear(null)} className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmClear}
            className="press rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground"
          >
            Remove
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-surface-1 text-foreground"
          )}
        >
          <span className="flex-1">{notice.text}</span>
          {notice.noteName && (
            <button
              type="button"
              onClick={() => api().whisperwoofOpenVoiceNote?.(notice.noteName ?? null)}
              className="rounded-full px-3 py-1 text-xs font-semibold text-primary hover:bg-foreground/[0.05]"
            >
              Open note
            </button>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Column
          title="Text"
          count={searching ? text.items.length : (summary?.textCount ?? text.items.length)}
          empty={searching ? "No text matches." : "Copy some text and it shows up here."}
          showEmpty={text.loaded && text.items.length === 0}
          hasMore={text.hasMore}
          onMore={text.loadMore}
        >
          <ul className="space-y-0.5">
            {text.items.map((item) => (
              <TextRow key={item.id} item={item} copied={copiedId === item.id} {...actions} />
            ))}
          </ul>
        </Column>
        <Column
          title={files.items.length > 0 || keepFiles ? "Images and files" : "Images"}
          count={
            searching
              ? images.items.length + files.items.length
              : (summary?.imageCount ?? images.items.length) + (summary?.fileCount ?? files.items.length)
          }
          empty={
            searching
              ? "No image or file names match."
              : keepFiles
                ? "Screenshots, photos and files you copy show up here."
                : "Screenshots and photos you copy show up here."
          }
          showEmpty={images.loaded && files.loaded && images.items.length === 0 && files.items.length === 0}
          hasMore={images.hasMore}
          onMore={images.loadMore}
        >
          {images.items.length > 0 && (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-2.5 gap-y-3 px-1.5 pt-1">
              {images.items.map((item) => (
                <ImageTile key={item.id} item={item} copied={copiedId === item.id} onOpen={setOpen} {...actions} />
              ))}
            </ul>
          )}
          {files.items.length > 0 && (
            <>
              <h3 className="px-3 pb-1 pt-4 text-xs font-semibold text-muted-foreground">Files</h3>
              <ul className="space-y-0.5">
                {files.items.map((item) => (
                  <FileRow key={item.id} item={item} copied={copiedId === item.id} onReveal={onReveal} {...actions} />
                ))}
              </ul>
              {files.hasMore && (
                <button
                  type="button"
                  onClick={files.loadMore}
                  className="mx-auto mt-2 block rounded-full px-3 py-1 text-xs text-primary transition-colors hover:bg-foreground/[0.05]"
                >
                  Show more files
                </button>
              )}
            </>
          )}
        </Column>
      </div>

      {open && <Lightbox item={open} onClose={() => setOpen(null)} {...actions} />}
    </div>
  );
}
