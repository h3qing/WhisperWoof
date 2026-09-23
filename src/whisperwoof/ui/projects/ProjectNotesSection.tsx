import { useEffect, useState } from "react";
import { FileText, Keyboard } from "lucide-react";
import { cn } from "../../../components/lib/utils";

// Inside a project: its voice notes (the .md files filed there) and whether
// fn+P saves into this project.

interface ProjectNote {
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly mtimeMs: number;
}

interface ProjectNotesApi {
  whisperwoofProjectNotes?: (projectId: string) => Promise<{ success: boolean; notes?: ProjectNote[] }>;
  whisperwoofGetDefaultProject?: () => Promise<{ success: boolean; project?: { id: string; name: string } }>;
  whisperwoofSetDefaultProject?: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  whisperwoofOpenVoiceNote?: (name: string | null) => Promise<{ success: boolean }>;
  onWhisperwoofEntrySaved?: (cb: () => void) => () => void;
}

const api = () => (window as unknown as { electronAPI?: ProjectNotesApi }).electronAPI;

function firstLine(note: ProjectNote): string {
  const lines = note.body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).filter(Boolean);
  return (lines[0] === note.title ? lines.slice(1) : lines).join(" ");
}

/** "fn+P saves here" — or a button to make it so. */
export function DefaultProjectToggle({ projectId }: { projectId: string }) {
  const [defaultId, setDefaultId] = useState<string | null>(null);

  useEffect(() => {
    api()?.whisperwoofGetDefaultProject?.().then((r) => setDefaultId(r?.project?.id ?? null));
  }, [projectId]);

  if (defaultId === projectId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-foreground">
        <Keyboard size={11} aria-hidden="true" />
        fn+P saves here
      </span>
    );
  }
  return (
    <button
      onClick={async () => {
        const r = await api()?.whisperwoofSetDefaultProject?.(projectId);
        if (r?.success) setDefaultId(projectId);
      }}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <Keyboard size={11} aria-hidden="true" />
      Make fn+P save here
    </button>
  );
}

export function ProjectNotesSection({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api()
        ?.whisperwoofProjectNotes?.(projectId)
        .then((r) => {
          if (!cancelled && r?.success) setNotes(r.notes ?? []);
        });
    load();
    // A fn+P dictation lands while the project is open.
    const off = api()?.onWhisperwoofEntrySaved?.(() => load());
    return () => {
      cancelled = true;
      off?.();
    };
  }, [projectId]);

  if (notes.length === 0) return null;

  return (
    <section className="px-4 pb-3">
      <h3 className="pb-1.5 text-xs font-medium text-muted-foreground">Notes</h3>
      <div className="rounded-xl bg-card shadow-card divide-y divide-border-subtle overflow-hidden">
        {notes.map((note) => (
          <button
            key={note.name}
            onClick={() => api()?.whisperwoofOpenVoiceNote?.(note.name)}
            className={cn(
              "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
              "hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:bg-foreground/[0.05]"
            )}
          >
            <FileText size={14} className="mt-0.5 shrink-0 text-mando" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{note.title}</span>
              {firstLine(note) && (
                <span className="block truncate text-xs text-muted-foreground">{firstLine(note)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
