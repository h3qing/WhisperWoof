import { FolderOpen } from "lucide-react";

// Which project a voice note belongs to (the keyboard alternative to dragging
// it onto a project in the folder column).

interface Project {
  readonly id: string;
  readonly name: string;
}

interface NoteProjectPickerProps {
  readonly projects: readonly Project[];
  readonly projectId: string;
  readonly projectName: string;
  readonly onChange: (projectId: string | null) => void;
}

export function NoteProjectPicker({ projects, projectId, projectName, onChange }: NoteProjectPickerProps) {
  // A project named in the file but not (or no longer) in the app still shows.
  const known = projects.some((p) => p.id === projectId);

  return (
    <label className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-foreground/5 transition-colors">
      <FolderOpen size={12} aria-hidden="true" />
      <span className="sr-only">Project</span>
      <select
        value={projectId}
        onChange={(e) => onChange(e.target.value || null)}
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
