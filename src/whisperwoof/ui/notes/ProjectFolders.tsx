import { useState, type DragEvent, type ReactNode } from "react";
import { FileText, Folder, Inbox, MoreHorizontal, Plus, Star } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import type { NoteFolder } from "./note-folders";

// Folder column of the Notes view. Notes are dragged here to file them into a
// project (or out, onto "No project").

export const NOTE_DRAG_TYPE = "application/x-whisperwoof-note";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectFoldersProps {
  readonly projects: readonly Project[];
  readonly counts: { all: number; none: number; byProject: Record<string, number> };
  readonly defaultId: string | null;
  readonly folder: NoteFolder;
  readonly onSelect: (folder: NoteFolder) => void;
  readonly onDropNote: (noteName: string, projectId: string | null) => void;
  /** Resolve to an error message, or null on success. */
  readonly onCreate: (name: string) => Promise<string | null>;
  readonly onRename: (id: string, name: string) => Promise<string | null>;
  readonly onDelete: (id: string) => void;
  readonly onMakeDefault: (id: string) => void;
}

const isSame = (a: NoteFolder, b: NoteFolder) =>
  a.kind === b.kind && (a.kind !== "project" || (b.kind === "project" && a.id === b.id));

function NameInput({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (v: string) => Promise<string | null>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const err = await onSubmit(value);
    if (err) setError(err);
  };
  return (
    <div className="px-1 py-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => (value.trim() && value !== initial ? submit() : onCancel())}
        aria-label="Project name"
        placeholder="Project name"
        className="w-full h-7 rounded-md px-2 text-sm"
      />
      {error && <p className="mt-1 px-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function ProjectFolders(props: ProjectFoldersProps) {
  const { projects, counts, defaultId, folder, onSelect, onDropNote } = props;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const dropHandlers = (key: string, projectId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (e: DragEvent) => {
      const name = e.dataTransfer.getData(NOTE_DRAG_TYPE);
      setDropTarget(null);
      if (name) onDropNote(name, projectId);
    },
  });

  const row = (key: string, target: NoteFolder, icon: ReactNode, label: ReactNode, count: number, dropProjectId?: string | null) => (
    <button
      key={key}
      onClick={() => onSelect(target)}
      {...(dropProjectId !== undefined ? dropHandlers(key, dropProjectId) : {})}
      className={cn(
        "press flex w-full min-w-0 items-center gap-2 rounded-full px-3 min-h-8 text-left text-sm text-foreground",
        isSame(folder, target) ? "bg-select font-semibold" : "font-medium hover:bg-[var(--glass-hover)]",
        dropTarget === key && "ring-2 ring-primary bg-select"
      )}
    >
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );

  return (
    <nav aria-label="Projects" className="w-48 shrink-0 flex flex-col min-h-0 rounded-[var(--radius-sheet)] glass-thick p-2">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-sm font-semibold text-foreground">Folders</span>
        <button
          onClick={() => setCreating(true)}
          aria-label="New project"
          title="New project"
          className="press rounded-full p-1 text-primary hover:bg-[var(--glass-hover)]"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {row("all", { kind: "all" }, <FileText size={14} />, "All notes", counts.all)}

        <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">Projects</p>
        {projects.map((p) =>
          renamingId === p.id ? (
            <NameInput
              key={p.id}
              initial={p.name}
              onCancel={() => setRenamingId(null)}
              onSubmit={async (name) => {
                const err = await props.onRename(p.id, name);
                if (!err) setRenamingId(null);
                return err;
              }}
            />
          ) : (
            <div key={p.id} className="group relative">
              {row(
                p.id,
                { kind: "project", id: p.id },
                p.name === "Inbox" ? <Inbox size={14} /> : <Folder size={14} />,
                <span className="flex items-center gap-1">
                  <span className="truncate">{p.name}</span>
                  {p.id === defaultId && (
                    <Star size={11} className="shrink-0 fill-primary text-primary" aria-label="fn+P saves here" />
                  )}
                </span>,
                counts.byProject[p.id] ?? 0,
                p.id
              )}
              <button
                onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                aria-label={`${p.name} options`}
                className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-foreground/10 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal size={13} />
              </button>
              {menuId === p.id && (
                <div className="glass-thick absolute inset-x-0 top-full z-20 mt-1 rounded-xl p-1 text-[13px]" onMouseLeave={() => setMenuId(null)}>
                  {confirmDeleteId === p.id ? (
                    <div className="p-2">
                      <p className="text-xs text-foreground">Delete “{p.name}”? Its notes are kept.</p>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          onClick={() => {
                            props.onDelete(p.id);
                            setConfirmDeleteId(null);
                            setMenuId(null);
                          }}
                          className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground"
                        >
                          Delete
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {p.id !== defaultId && (
                        <button onClick={() => { props.onMakeDefault(p.id); setMenuId(null); }} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-foreground/5">
                          Make fn+P save here
                        </button>
                      )}
                      <button onClick={() => { setRenamingId(p.id); setMenuId(null); }} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-foreground/5">
                        Rename
                      </button>
                      <button onClick={() => setConfirmDeleteId(p.id)} className="w-full rounded-md px-2 py-1.5 text-left text-destructive hover:bg-destructive/10">
                        Delete project…
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        )}
        {creating && (
          <NameInput
            initial=""
            onCancel={() => setCreating(false)}
            onSubmit={async (name) => {
              const err = await props.onCreate(name);
              if (!err) setCreating(false);
              return err;
            }}
          />
        )}
        {projects.length === 0 && !creating && (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
            fn+P creates an Inbox, or add a project with +.
          </p>
        )}

        <div className="pt-2">
          {row("none", { kind: "none" }, <FileText size={14} />, "No project", counts.none, null)}
        </div>
      </div>
    </nav>
  );
}
