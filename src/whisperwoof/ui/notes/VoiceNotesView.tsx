import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Search, Trash2, ExternalLink } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import { NoteProjectPicker } from "./NoteProjectPicker";
import { PlayRecordingButton } from "./PlayRecordingButton";
import { NOTE_DRAG_TYPE, ProjectFolders } from "./ProjectFolders";
import { folderCounts, notesInFolder, projectOf, type NoteFolder } from "./note-folders";
import { useNoteProjects } from "./useNoteProjects";

// Notes: the .md files in the notes folder (where fn+N / fn+P save), filed
// into projects from the folder column (drag a note onto a project). The files
// are the source of truth — edits are written straight back, so the same
// folder works in Obsidian, iCloud, Finder.

interface VoiceNote {
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly date: string;
  readonly mtimeMs: number;
  readonly entryId: string;
  readonly project: string;
  readonly projectId: string;
}

interface NotesApi {
  whisperwoofNotesList: () => Promise<{ success: boolean; dir?: string; notes: VoiceNote[]; error?: string }>;
  whisperwoofNotesUpdate: (name: string, body: string) => Promise<{ success: boolean; error?: string }>;
  whisperwoofNotesTrash: (name: string) => Promise<{ success: boolean; error?: string }>;
  whisperwoofNotesReveal: (name: string) => Promise<{ success: boolean }>;
  whisperwoofNotesOpenFolder: () => Promise<{ success: boolean; error?: string }>;
  whisperwoofNotesWatch: () => Promise<{ success: boolean }>;
  onWhisperwoofNotesChanged: (cb: () => void) => () => void;
}

const api = () => (window as unknown as { electronAPI?: Partial<NotesApi> }).electronAPI;

const SAVE_DELAY_MS = 600;

function relativeTime(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function matchesQuery(note: VoiceNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${note.title}\n${note.body}`.toLowerCase().includes(q);
}

function preview(note: VoiceNote): string {
  const lines = note.body
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  const rest = lines[0] === note.title ? lines.slice(1) : lines;
  return rest.join(" ");
}

interface VoiceNotesViewProps {
  /** Note to open (from "Saved as note → Open"). */
  readonly focusName?: string | null;
}

export default function VoiceNotesView({ focusName = null }: VoiceNotesViewProps) {
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [dir, setDir] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<NoteFolder>({ kind: "all" });
  const [selected, setSelected] = useState<string | null>(focusName);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [freshNames, setFreshNames] = useState<ReadonlySet<string>>(new Set());
  const knownNames = useRef<Set<string> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // Which note the draft belongs to, what we last wrote (trimmed, as it comes
  // back from disk), and a counter so an older save can't clear newer typing.
  const draftOf = useRef<string | null>(null);
  const lastSaved = useRef<{ name: string; body: string } | null>(null);
  const editSeq = useRef(0);
  const projectsState = useNoteProjects(setError);
  const { projects, defaultId, reload: reloadProjects } = projectsState;

  const load = useCallback(async () => {
    const result = await api()?.whisperwoofNotesList?.();
    if (!result) return;
    if (!result.success) {
      setError(result.error ?? "Couldn't read the notes folder");
      return;
    }
    setError(null);
    setDir(result.dir ?? "");
    setNotes(result.notes);
    // Notes that appear while the view is open get a "new" dot.
    const names = result.notes.map((n) => n.name);
    if (knownNames.current) {
      const known = knownNames.current;
      const added = names.filter((n) => !known.has(n));
      if (added.length) setFreshNames((prev) => new Set([...prev, ...added]));
    }
    knownNames.current = new Set(names);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    api()?.whisperwoofNotesWatch?.();
    // fn+P can create the Inbox project while this view is open.
    const off = api()?.onWhisperwoofNotesChanged?.(() => {
      load();
      reloadProjects();
    });
    return () => off?.();
  }, [load, reloadProjects]);

  useEffect(() => {
    if (!focusName) return;
    setFolder({ kind: "all" });
    setSelected(focusName);
  }, [focusName]);

  const visible = useMemo(
    () => notesInFolder(notes, folder, projects).filter((n) => matchesQuery(n, query)),
    [notes, folder, projects, query]
  );
  const counts = useMemo(() => folderCounts(notes, projects), [notes, projects]);

  // Default to the newest note in view (or when the selected one is gone).
  useEffect(() => {
    if (!selected || !visible.some((n) => n.name === selected)) {
      setSelected(visible[0]?.name ?? null);
    }
  }, [visible, selected]);

  const current = notes.find((n) => n.name === selected) ?? null;

  // Load the file into the editor when switching notes, or when the file
  // changed outside the app. Our own save coming back (trimmed) is ignored, so
  // a trailing space or newline you just typed isn't eaten.
  useEffect(() => {
    if (!current) return;
    if (draftOf.current !== current.name) {
      draftOf.current = current.name;
      setDraft(current.body);
      return;
    }
    if (dirty.current) return;
    const saved = lastSaved.current;
    if (saved && saved.name === current.name && saved.body === current.body) return;
    setDraft(current.body);
  }, [current]);

  const flush = useCallback(async (name: string, body: string, seq: number) => {
    setSaveState("saving");
    lastSaved.current = { name, body: body.trim() };
    const result = await api()?.whisperwoofNotesUpdate?.(name, body);
    if (seq === editSeq.current) dirty.current = false;
    setSaveState(result?.success ? "saved" : "idle");
    if (!result?.success) setError(result?.error ?? "Couldn't save the note");
  }, []);

  const onEdit = (value: string) => {
    if (!current) return;
    setDraft(value);
    dirty.current = true;
    const seq = ++editSeq.current;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const name = current.name;
    saveTimer.current = setTimeout(() => flush(name, value, seq), SAVE_DELAY_MS);
  };

  const select = (name: string) => {
    if (saveTimer.current && current && dirty.current) {
      clearTimeout(saveTimer.current);
      flush(current.name, draft, editSeq.current);
    }
    dirty.current = false;
    setSelected(name);
    setSaveState("idle");
    setFreshNames((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const trash = async () => {
    if (!current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirty.current = false;
    const trashed = current.name;
    const result = await api()?.whisperwoofNotesTrash?.(trashed);
    if (!result?.success) {
      setError(result?.error ?? "Couldn't move the note to the Trash");
      return;
    }
    setSelected(visible.find((n) => n.name !== trashed)?.name ?? null);
    load();
  };

  const fileNote = async (name: string, projectId: string | null) => {
    const result = await (window as unknown as {
      electronAPI?: { whisperwoofNotesSetProject?: (n: string, p: string | null) => Promise<{ success: boolean; error?: string }> };
    }).electronAPI?.whisperwoofNotesSetProject?.(name, projectId);
    if (!result?.success) setError(result?.error ?? "Couldn't move the note");
    load();
  };

  const folderLabel =
    folder.kind === "all"
      ? "All notes"
      : folder.kind === "none"
        ? "No project"
        : projects.find((p) => p.id === folder.id)?.name ?? "Project";

  return (
    <div className="flex h-full max-w-6xl mx-auto w-full gap-3 p-3">
      <ProjectFolders
        projects={projects}
        counts={counts}
        defaultId={defaultId}
        folder={folder}
        onSelect={setFolder}
        onDropNote={fileNote}
        onCreate={async (name) => {
          const { id, error: err } = await projectsState.create(name);
          if (id) setFolder({ kind: "project", id });
          return err ?? null;
        }}
        onRename={projectsState.rename}
        onDelete={async (id) => {
          if (folder.kind === "project" && folder.id === id) setFolder({ kind: "all" });
          await projectsState.remove(id);
          load();
        }}
        onMakeDefault={projectsState.makeDefault}
      />

      {/* List */}
      <div className="w-64 shrink-0 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="truncate text-sm font-semibold text-foreground">{folderLabel}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{visible.length}</span>
        </div>
        <label className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
            className="w-full h-8 rounded-md bg-card shadow-card pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-card shadow-card divide-y divide-border-subtle">
          {loaded && visible.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">
              {query.trim()
                ? "No notes match your search."
                : folder.kind === "project"
                  ? "Drag notes here, or make this the fn+P project."
                  : "No notes yet."}
            </p>
          )}
          {visible.map((note) => (
            <button
              key={note.name}
              onClick={() => select(note.name)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(NOTE_DRAG_TYPE, note.name);
                e.dataTransfer.effectAllowed = "move";
              }}
              className={cn(
                "w-full text-left px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:bg-foreground/[0.05]",
                note.name === selected ? "bg-primary/12" : "hover:bg-foreground/[0.03]"
              )}
            >
              <div className="flex items-center gap-1.5">
                {freshNames.has(note.name) && (
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="New" />
                )}
                <span className="truncate text-sm font-medium text-foreground">{note.title}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview(note) || " "}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <span>{relativeTime(note.mtimeMs)}</span>
                {folder.kind === "all" && projectOf(note, projects) && (
                  <span className="truncate rounded-full bg-foreground/[0.06] px-1.5 text-muted-foreground">
                    {projectOf(note, projects)?.name}
                  </span>
                )}
              </p>
            </button>
          ))}
        </div>

        <button
          onClick={() => api()?.whisperwoofNotesOpenFolder?.()}
          className="mt-2 flex items-center gap-1.5 px-1 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          title={dir}
        >
          <FolderOpen size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{dir || "Notes folder"}</span>
        </button>
      </div>

      {/* Note */}
      <div className="flex-1 min-w-0 flex flex-col rounded-xl bg-card shadow-card">
        {error && <p className="px-5 pt-3 text-xs text-destructive">{error}</p>}
        {current ? (
          <>
            <div className="flex items-start justify-between gap-3 px-5 pt-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">{current.title}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(current.date || current.mtimeMs).toLocaleString()}
                  <span className="ml-2" aria-live="polite">
                    {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
                  </span>
                </p>
                <div className="mt-2 -ml-1.5 flex flex-wrap items-center gap-1">
                  <NoteProjectPicker
                    projects={projects}
                    projectId={current.projectId}
                    projectName={current.project}
                    onChange={(projectId) => fileNote(current.name, projectId)}
                  />
                  {current.entryId && <PlayRecordingButton entryId={current.entryId} />}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => api()?.whisperwoofNotesReveal?.(current.name)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Show in Finder
                </button>
                <button
                  onClick={trash}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 size={12} aria-hidden="true" />
                  Move to Trash
                </button>
              </div>
            </div>
            <textarea
              value={draft}
              onChange={(e) => onEdit(e.target.value)}
              aria-label="Note text"
              className="bare-field flex-1 min-h-0 resize-none px-5 py-4 text-sm leading-relaxed text-foreground focus:outline-none"
            />
          </>
        ) : (
          loaded && (
            <div className="m-auto max-w-xs px-6 text-center">
              <FileText size={28} className="mx-auto mb-3 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Save a thought as a note</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Hold <kbd className="rounded bg-muted px-1 font-sans">fn</kbd>, press{" "}
                <kbd className="rounded bg-muted px-1 font-sans">N</kbd>, and speak. The note is saved as a Markdown
                file in your notes folder and shows up here.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
