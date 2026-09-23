import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

// Which project a voice note belongs to. Changing it rewrites the note's
// frontmatter and moves its recorded dictation along with it.

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectsApi {
  whisperwoofGetProjects?: () => Promise<Project[]>;
  whisperwoofNotesSetProject?: (name: string, projectId: string | null) => Promise<{ success: boolean; error?: string }>;
}

const api = () => (window as unknown as { electronAPI?: ProjectsApi }).electronAPI;

interface NoteProjectPickerProps {
  readonly noteName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}

export function NoteProjectPicker({ noteName, projectId, projectName, onChanged, onError }: NoteProjectPickerProps) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api()
      ?.whisperwoofGetProjects?.()
      .then((rows) => setProjects(Array.isArray(rows) ? rows.map(({ id, name }) => ({ id, name })) : []));
  }, []);

  // A project named in the file but not (or no longer) in the app still shows.
  const known = projects.some((p) => p.id === projectId);

  const change = async (value: string) => {
    const result = await api()?.whisperwoofNotesSetProject?.(noteName, value || null);
    if (result?.success) onChanged();
    else onError(result?.error ?? "Couldn't change the project");
  };

  return (
    <label className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-foreground/5 transition-colors">
      <FolderOpen size={12} aria-hidden="true" />
      <span className="sr-only">Project</span>
      <select
        value={projectId}
        onChange={(e) => change(e.target.value)}
        className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer"
      >
        <option value="">No project</option>
        {!known && projectId && <option value={projectId}>{projectName || "Unknown project"}</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
