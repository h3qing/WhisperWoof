import { useCallback, useEffect, useState } from "react";

// Projects for the Notes view's folder column + note picker, and the
// project actions (create / rename / delete / fn+P default).

export interface NoteProject {
  readonly id: string;
  readonly name: string;
}

interface ProjectsApi {
  whisperwoofGetProjects?: () => Promise<{ id: string; name: string }[]>;
  whisperwoofGetDefaultProject?: () => Promise<{ success: boolean; project?: NoteProject | null }>;
  whisperwoofCreateProject?: (name: string) => Promise<{ success: boolean; id?: string; error?: string }>;
  whisperwoofRenameProject?: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
  whisperwoofDeleteProject?: (id: string) => Promise<{ success: boolean; error?: string }>;
  whisperwoofSetDefaultProject?: (id: string) => Promise<{ success: boolean; error?: string }>;
}

const api = () => (window as unknown as { electronAPI?: ProjectsApi }).electronAPI;

export function useNoteProjects(onError: (message: string) => void) {
  const [projects, setProjects] = useState<NoteProject[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [rows, current] = await Promise.all([
      api()?.whisperwoofGetProjects?.(),
      api()?.whisperwoofGetDefaultProject?.(),
    ]);
    // Oldest first, so new projects land at the bottom of the column.
    setProjects((Array.isArray(rows) ? rows : []).map(({ id, name }) => ({ id, name })).reverse());
    setDefaultId(current?.success ? current.project?.id ?? null : null);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** New project's id, or an error message. */
  const create = async (name: string): Promise<{ id?: string; error?: string }> => {
    const result = await api()?.whisperwoofCreateProject?.(name);
    if (!result?.success) return { error: result?.error ?? "Couldn't create the project" };
    await reload();
    return { id: result.id };
  };

  const rename = async (id: string, name: string): Promise<string | null> => {
    const result = await api()?.whisperwoofRenameProject?.(id, name);
    if (!result?.success) return result?.error ?? "Couldn't rename the project";
    await reload();
    return null;
  };

  const remove = async (id: string) => {
    const result = await api()?.whisperwoofDeleteProject?.(id);
    if (!result?.success) onError(result?.error ?? "Couldn't delete the project");
    await reload();
  };

  const makeDefault = async (id: string) => {
    const result = await api()?.whisperwoofSetDefaultProject?.(id);
    if (result?.success) setDefaultId(id);
    else onError(result?.error ?? "Couldn't change the fn+P project");
  };

  return { projects, defaultId, reload, create, rename, remove, makeDefault };
}
