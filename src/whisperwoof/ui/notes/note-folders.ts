// Folder column of the Notes view: All notes, projects, No project.

export type NoteFolder = { kind: "all" } | { kind: "none" } | { kind: "project"; id: string };

interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

interface FiledNote {
  readonly projectId: string;
}

/** The project a note is filed in; null when unfiled or the project no longer exists. */
export function projectOf<P extends ProjectRef>(note: FiledNote, projects: readonly P[]): P | null {
  return (note.projectId && projects.find((p) => p.id === note.projectId)) || null;
}

export function notesInFolder<N extends FiledNote>(
  notes: readonly N[],
  folder: NoteFolder,
  projects: readonly ProjectRef[]
): N[] {
  if (folder.kind === "all") return [...notes];
  if (folder.kind === "none") return notes.filter((n) => !projectOf(n, projects));
  return notes.filter((n) => n.projectId === folder.id);
}

export function folderCounts(notes: readonly FiledNote[], projects: readonly ProjectRef[]) {
  const byProject: Record<string, number> = Object.fromEntries(projects.map((p) => [p.id, 0]));
  let none = 0;
  for (const n of notes) {
    const project = projectOf(n, projects);
    if (project) byProject[project.id] += 1;
    else none += 1;
  }
  return { all: notes.length, none, byProject };
}
