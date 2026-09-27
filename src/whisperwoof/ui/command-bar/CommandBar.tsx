import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ArrowRight,
  Clipboard,
  Command,
  File,
  FileText,
  Image as ImageIcon,
  Mic,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import ReasoningService from "../../../services/ReasoningService";
import { guardPolishedOutput } from "../../core/polish/polish-output-guard";
import { getSettings, getEffectiveReasoningModel } from "../../../stores/settingsStore";
import { cn } from "../../../components/lib/utils";
import { Preview } from "../smart-clipboard/ClipboardPreview";
import {
  buildSections,
  enterLabel,
  flattenRows,
  isCommandInput,
  moveSelection,
  noResultsLine,
  paletteHint,
  searchMeetingNotes,
  searchNoteDocs,
  type EverythingResults,
  type MeetingNoteDoc,
  type NoteDoc,
  type PaletteAction,
  type PaletteRow,
  type RowIcon,
  type TextMatch,
} from "./search-palette";

/**
 * ⌘K — search everything, and the command bar.
 *
 * Typing searches what WhisperWoof keeps: History, Notes, meeting notes, the
 * clipboard's text, images (by name, and by the words in them when "Words in
 * images" is on) and kept files. ↵ opens a result where it lives, or copies a
 * clipboard item back; ⌘↵ shows a clipboard item in Clipboard. The search
 * runs in the main process (bridge/global-search.js); notes are filtered here.
 *
 * Starting with "/" turns it into the command bar, text into the pipeline:
 *   /note Meeting notes  → saves as markdown
 *   /project Ideas       → captures to project
 *   /paste Hello         → paste at cursor (polished)
 *   /todo, /slack, /cal  → paste at cursor, recorded with that route
 *
 * Polish routes through OpenWhispr's ReasoningService (same path as dictation),
 * gated on the same `useReasoningModel` setting and using the canonical
 * `cleanupPrompt`. No polish when the setting is off or no model selected.
 */

/**
 * Polish text via ReasoningService (mirrors audioManager.processTranscription).
 * Returns { text, polished } where polished=true only if reasoning actually ran.
 */
async function polishViaReasoning(text: string): Promise<{ text: string; polished: boolean }> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return { text: trimmed, polished: false };

  try {
    const settings = getSettings();
    if (!settings.useReasoningModel) return { text: trimmed, polished: false };

    const model = getEffectiveReasoningModel();
    if (!model) return { text: trimmed, polished: false };

    const agentName =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage.getItem("agentName") || null
        : null;

    const result = await ReasoningService.processText(trimmed, model, agentName);
    const clean = typeof result === "string" ? result.trim() : "";
    if (!clean) return { text: trimmed, polished: false };
    // Same deliberation guard the dictation path applies: a small model's
    // inline commentary must never reach a saved note.
    const guarded = guardPolishedOutput(trimmed, clean);
    if (!guarded.accepted) return { text: trimmed, polished: false };
    return { text: clean, polished: true };
  } catch {
    return { text: trimmed, polished: false };
  }
}

/** Where a result opens (everything but copying, which the palette does itself). */
export type PaletteNavigation = Exclude<PaletteAction, { kind: "copy" }>;

interface CommandBarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigate?: (to: PaletteNavigation) => void;
  readonly onCopied?: (what: "text" | "image" | "file") => void;
}

interface RouteMatch {
  readonly prefix: string;
  readonly label: string;
  readonly destination: string;
}

const ROUTES: readonly RouteMatch[] = [
  { prefix: "/note", label: "Save as Markdown", destination: "save-as-markdown" },
  { prefix: "/project", label: "Capture to Project", destination: "project" },
  { prefix: "/paste", label: "Paste at cursor", destination: "paste-at-cursor" },
  { prefix: "/todo", label: "Add to Todoist", destination: "todoist" },
  { prefix: "/slack", label: "Send to Slack", destination: "slack" },
  { prefix: "/cal", label: "Add to Calendar", destination: "calendar" },
];

function matchRoute(input: string): { route: RouteMatch | null; text: string } {
  const trimmed = input.trim();
  for (const route of ROUTES) {
    if (trimmed.startsWith(route.prefix + " ") || trimmed === route.prefix) {
      return {
        route,
        text: trimmed.slice(route.prefix.length).trim(),
      };
    }
  }
  return { route: null, text: trimmed };
}

interface PaletteApi {
  whisperwoofSearchEverything?: (q: string) => Promise<({ success: boolean; error?: string } & Partial<EverythingResults>) | undefined>;
  whisperwoofNotesList?: () => Promise<{ success: boolean; notes?: NoteDoc[] } | undefined>;
  getNotes?: (noteType: string | null, limit?: number) => Promise<MeetingNoteDoc[] | undefined>;
  whisperwoofClipboardCopy?: (id: string) => Promise<{ success: boolean; error?: string } | undefined>;
  whisperwoofSaveMarkdown?: (text: string) => Promise<unknown>;
  whisperwoofSaveEntry?: (entry: Record<string, unknown>) => Promise<unknown>;
  pasteText?: (text: string) => Promise<unknown>;
}
const electron = (): PaletteApi => (window as unknown as { electronAPI?: PaletteApi }).electronAPI ?? {};

const ICONS: Record<RowIcon, React.ComponentType<{ size?: number; className?: string }>> = {
  dictation: Mic,
  meeting: Users,
  import: Upload,
  note: FileText,
  "meeting-note": Users,
  text: Clipboard,
  image: ImageIcon,
  file: File,
  more: ArrowRight,
};

function Snippet({ match }: { readonly match: TextMatch }) {
  return (
    <>
      {match.before}
      <mark className="bg-transparent font-semibold text-primary">{match.match}</mark>
      {match.after}
    </>
  );
}

function ResultRow({
  row,
  index,
  selected,
  onHover,
  onRun,
}: {
  readonly row: PaletteRow;
  readonly index: number;
  readonly selected: boolean;
  readonly onHover: (index: number) => void;
  readonly onRun: (action: PaletteAction) => void;
}) {
  const Icon = ICONS[row.icon];
  const more = row.icon === "more";
  return (
    <button
      type="button"
      data-row={index}
      onMouseMove={() => onHover(index)}
      onClick={(e) => onRun(e.metaKey || e.ctrlKey ? (row.alt ?? row.action) : row.action)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 text-left outline-none",
        more ? "py-1.5" : "py-2",
        selected && "bg-select"
      )}
    >
      {row.imageId ? (
        <Preview id={row.imageId} className="size-10 shrink-0 overflow-hidden rounded-md" />
      ) : (
        <span className={cn("flex shrink-0 items-center justify-center text-primary", more ? "size-5" : "size-8 rounded-full bg-surface-1")}>
          <Icon size={more ? 13 : 14} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {more ? (
          <span className="block text-xs font-medium text-primary">{row.title}</span>
        ) : row.matchIsTitle ? (
          <span className="line-clamp-2 break-words text-sm text-foreground">
            {row.match ? <Snippet match={row.match} /> : row.title}
          </span>
        ) : (
          <>
            <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
            {row.match && (
              <span className="block truncate text-xs text-muted-foreground">
                <Snippet match={row.match} />
              </span>
            )}
          </>
        )}
        {row.meta && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.meta}</span>}
      </span>
    </button>
  );
}

function Key({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border border-b-2 bg-card px-1 text-[10px] font-semibold leading-[16px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export default function CommandBar({ isOpen, onClose, onNavigate, onCopied }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<EverythingResults | null>(null);
  const [imageText, setImageText] = useState<EverythingResults["imageText"] | null>(null);
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [meetingNotes, setMeetingNotes] = useState<MeetingNoteDoc[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  // Opened: an empty box, and the notes lists to search locally.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const api = electron();
    setTimeout(() => inputRef.current?.focus(), 50);
    api
      .whisperwoofNotesList?.()
      .then((res) => {
        if (!cancelled && res?.success) setNotes(res.notes ?? []);
      })
      .catch(() => {});
    api
      .getNotes?.(null, 300)
      .then((list) => {
        if (!cancelled) setMeetingNotes((list ?? []).filter((n) => n.note_type === "meeting" || n.note_type === "upload"));
      })
      .catch(() => {});
    api
      .whisperwoofSearchEverything?.("")
      .then((res) => {
        if (!cancelled && res?.success && res.imageText) setImageText(res.imageText);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setInput("");
      setSubmitting(false);
      setResults(null);
      setSelected(0);
      setError(null);
    };
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const commandMode = isCommandInput(input);
  const query = commandMode ? "" : input.trim();

  // Search as you type; only the answer to the latest query counts.
  useEffect(() => {
    if (!isOpen || !query) return;
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      electron()
        .whisperwoofSearchEverything?.(query)
        .then((res) => {
          if (seq !== searchSeq.current || !res?.success) return;
          const next = res as unknown as EverythingResults;
          setResults(next);
          if (next.imageText) setImageText(next.imageText);
        })
        .catch(() => {});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [isOpen, query]);

  const sections = useMemo(
    () =>
      buildSections({
        query,
        results,
        notes: searchNoteDocs(notes, query),
        meetingNotes: searchMeetingNotes(meetingNotes, query),
      }),
    [query, results, notes, meetingNotes]
  );
  const rows = useMemo(() => flattenRows(sections), [sections]);
  const current = rows.length > 0 ? Math.min(selected, rows.length - 1) : -1;
  const pending = Boolean(query) && results?.query !== query;

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = useCallback(
    async (action: PaletteAction) => {
      if (action.kind === "copy") {
        const res = await electron().whisperwoofClipboardCopy?.(action.id);
        if (!res?.success) {
          setError(res?.error ?? "That couldn’t be copied.");
          return;
        }
        onCopied?.(action.what);
        onClose();
        return;
      }
      onNavigate?.(action);
      onClose();
    },
    [onClose, onCopied, onNavigate]
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    const { route, text } = matchRoute(trimmed);
    if (!route) return;
    setSubmitting(true);
    const api = electron();

    try {
      if (route.destination === "save-as-markdown" && text) {
        // Polish first, then save
        const polishResult = await polishViaReasoning(text);
        const polished = polishResult.polished ? polishResult.text : text;
        await api.whisperwoofSaveMarkdown?.(polished);

        // Save to bf_entries
        await api.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: polishResult.polished ? polished : null,
          routedTo: "save-as-markdown",
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar" },
        });
      } else if (route.destination === "project" && text) {
        // For now, save to bf_entries with a project tag in metadata
        await api.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: null,
          routedTo: "project",
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar", projectHint: text },
        });
      } else if (text) {
        // Polish and paste at cursor
        const polishResult = await polishViaReasoning(text);
        const polished = polishResult.polished ? polishResult.text : text;
        await api.pasteText?.(polished);

        await api.whisperwoofSaveEntry?.({
          source: "voice",
          rawText: text,
          polished: polishResult.polished ? polished : null,
          routedTo: route.destination,
          hotkeyUsed: "Cmd+K",
          durationMs: null,
          projectId: null,
          audioPath: null,
          metadata: { via: "command-bar" },
        });
      }
    } catch {
      // Silently fail — entry saved to history anyway
    }

    onClose();
  }, [input, submitting, onClose]);

  const { route } = matchRoute(input);
  const selectedRow = current >= 0 ? rows[current] : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/40" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="glass-thick glass-rim relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-window)]"
      >
        {/* Input row */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-3">
          {commandMode ? (
            <Command size={16} className="shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Search size={16} className="shrink-0 text-primary" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSelected(0);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(moveSelection(current, e.key === "ArrowDown" ? 1 : -1, rows.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (commandMode) void handleSubmit();
                else if (selectedRow) void run(e.metaKey || e.ctrlKey ? (selectedRow.alt ?? selectedRow.action) : selectedRow.action);
              }
            }}
            placeholder="Search everything, or type / for a command"
            aria-label="Search everything"
            role="combobox"
            aria-expanded={rows.length > 0}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            // The app's input styles draw a capsule and focus ring; this box is the palette itself.
            style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
            disabled={submitting}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {error && <p className="shrink-0 px-4 pt-2 text-xs text-destructive">{error}</p>}

        {commandMode ? (
          <div className="flex items-center gap-2 px-4 py-2.5 text-xs">
            {route ? (
              <>
                <span className="font-medium text-primary">{route.label}</span>
                <span className="text-muted-foreground">↵ Enter to send</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Commands: {ROUTES.map((r) => r.prefix).join(", ")}
              </span>
            )}
          </div>
        ) : !query ? (
          <div className="px-4 py-3">
            <p className="text-sm text-muted-foreground">{paletteHint(imageText)}</p>
            <p className="pb-1 pt-3 text-xs font-semibold text-muted-foreground">Commands</p>
            <div className="space-y-1">
              {ROUTES.slice(0, 4).map((r) => (
                <div key={r.prefix} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <code className="font-mono text-primary">{r.prefix}</code>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {pending ? "Searching…" : noResultsLine(query, imageText)}
          </p>
        ) : (
          <>
            <div ref={listRef} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {sections.map((section) => (
                <div key={section.key} className="pb-1">
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{section.title}</p>
                  {section.rows.map((row) => {
                    const index = rows.indexOf(row);
                    return (
                      <ResultRow
                        key={row.key}
                        row={row}
                        index={index}
                        selected={index === current}
                        onHover={setSelected}
                        onRun={(action) => void run(action)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Key>↑</Key>
                <Key>↓</Key> Move
              </span>
              <span className="flex items-center gap-1">
                <Key>↵</Key> {enterLabel(selectedRow)}
              </span>
              {selectedRow?.alt && (
                <span className="flex items-center gap-1">
                  <Key>⌘↵</Key> Show in Clipboard
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                <Key>esc</Key> Close
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
