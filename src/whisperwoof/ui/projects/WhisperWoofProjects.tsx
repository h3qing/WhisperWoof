import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, FolderOpen, Mic, Clipboard, Send, Check, AlertCircle, Link2, Unlink } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import type { Entry, EntrySource, Project } from "../../core/storage/types";

interface WhisperWoofProjectsProps {
  readonly className?: string;
}

interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

// Helpers (pure, side-effect-free)

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function displayText(entry: Entry): string {
  return entry.polished ?? entry.rawText ?? "";
}

// Subcomponents

function SourceIcon({ source }: { readonly source: EntrySource }) {
  if (source === "voice") {
    return <Mic size={14} className="shrink-0 text-amber-500" />;
  }
  return <Clipboard size={14} className="shrink-0 text-muted-foreground" />;
}

function SourceBadge({ source }: { readonly source: EntrySource }) {
  const label = source === "voice" ? "Voice" : source === "clipboard" ? "Clipboard" : source;
  const badgeClass =
    source === "voice"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "bg-muted text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", badgeClass)}>
      {label}
    </span>
  );
}

type DispatchStatus = "idle" | "sending" | "success" | "error";

function EntryRow({
  entry,
  integrationPlugin,
  onDispatch,
}: {
  readonly entry: Entry;
  readonly integrationPlugin: Plugin | null;
  readonly onDispatch: (entryId: string, text: string) => Promise<void>;
}) {
  const text = displayText(entry);
  const [status, setStatus] = useState<DispatchStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleDispatch = async () => {
    if (!text || !integrationPlugin) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      await onDispatch(entry.id, text);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <div className="w-full text-left px-3 py-2.5 rounded-md hover:bg-foreground/4 dark:hover:bg-white/4 transition-colors duration-150 group">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <SourceIcon source={entry.source} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-snug truncate">
            {text ? truncate(text, 80) : <span className="italic text-muted-foreground">Empty entry</span>}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-muted-foreground">{relativeTime(entry.createdAt)}</span>
            <SourceBadge source={entry.source} />
            {entry.routedTo && (
              <span className="text-[11px] text-muted-foreground">
                &rarr; {entry.routedTo}
              </span>
            )}
          </div>
        </div>
        {/* Dispatch button — only show if project is bound to a plugin */}
        {integrationPlugin && text && (
          <div className="shrink-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {status === "idle" && (
              <button
                onClick={handleDispatch}
                className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                title={`Send to ${integrationPlugin.name}`}
              >
                <Send size={13} />
              </button>
            )}
            {status === "sending" && (
              <span className="p-1.5 text-muted-foreground animate-pulse">
                <Send size={13} />
              </span>
            )}
            {status === "success" && (
              <span className="p-1.5 text-green-500">
                <Check size={13} />
              </span>
            )}
            {status === "error" && (
              <span className="p-1.5 text-destructive" title={errorMsg}>
                <AlertCircle size={13} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ProjectItemProps {
  readonly project: Project;
  readonly isSelected: boolean;
  readonly entryCount: number | undefined;
  readonly integrationName: string | null;
  readonly onSelect: () => void;
  readonly onDelete: () => void;
}

function ProjectItem({ project, isSelected, entryCount, integrationName, onSelect, onDelete }: ProjectItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md transition-colors duration-150 outline-none group",
        "focus-visible:ring-1 focus-visible:ring-primary/30",
        isSelected
          ? "bg-primary/8 dark:bg-primary/12"
          : "hover:bg-foreground/4 dark:hover:bg-white/4"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{project.name}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] text-muted-foreground">
              {entryCount !== undefined ? `${entryCount} entries` : "\u2026"}
            </p>
            {integrationName && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-primary/70">
                <Link2 size={9} />
                {integrationName}
              </span>
            )}
          </div>
        </div>
        {hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            aria-label={`Delete ${project.name}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </button>
  );
}

function NewProjectInput({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        onSubmit(trimmed);
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="px-3 py-1.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        placeholder="Project name\u2026"
        className="w-full h-7 px-2 text-xs rounded-md border border-border/25 dark:border-white/10 bg-background outline-none focus:ring-1 focus:ring-primary/30"
      />
    </div>
  );
}

function IntegrationSelector({
  plugins,
  currentPluginId,
  onSelect,
}: {
  readonly plugins: readonly Plugin[];
  readonly currentPluginId: string | null;
  readonly onSelect: (pluginId: string | null) => void;
}) {
  const enabledPlugins = plugins.filter((p) => p.enabled);

  return (
    <div className="flex items-center gap-2">
      <select
        value={currentPluginId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="h-7 px-2 text-xs rounded-md border border-border/25 dark:border-white/10 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary/30"
      >
        <option value="">No integration</option>
        {enabledPlugins.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {currentPluginId && (
        <button
          onClick={() => onSelect(null)}
          className="p-1 rounded hover:bg-foreground/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
          title="Remove integration"
        >
          <Unlink size={13} />
        </button>
      )}
    </div>
  );
}

// Main component

export default function WhisperWoofProjects({ className }: WhisperWoofProjectsProps) {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plugin state
  const [plugins, setPlugins] = useState<readonly Plugin[]>([]);
  const [integrations, setIntegrations] = useState<Record<string, string | null>>({});

  // Load plugins once
  useEffect(() => {
    const loadPlugins = async () => {
      try {
        const data = await window.electronAPI.whisperwoofGetPlugins();
        setPlugins(data ?? []);
      } catch {
        // Plugins are optional — don't block the view
      }
    };
    loadPlugins();
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await window.electronAPI.whisperwoofGetProjects();
      setProjects(data ?? []);
    } catch {
      setError("Failed to load projects.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Load integration targets for all projects (single batched IPC call)
  useEffect(() => {
    let cancelled = false;

    const loadIntegrations = async () => {
      try {
        const result = await window.electronAPI.whisperwoofGetProjectIntegrations();
        if (!cancelled) setIntegrations(result ?? {});
      } catch {
        if (!cancelled) setIntegrations({});
      }
    };

    if (projects.length > 0) loadIntegrations();
    return () => { cancelled = true; };
  }, [projects]);

  // Load entries when a project is selected
  useEffect(() => {
    if (selectedId == null) {
      setEntries([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await window.electronAPI.whisperwoofGetProjectEntries(selectedId, 100);
        if (!cancelled) {
          setEntries(data ?? []);
          setEntryCounts((prev) => ({ ...prev, [selectedId]: (data ?? []).length }));
        }
      } catch {
        if (!cancelled) setError("Failed to load project entries.");
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedId]);

  // Load entry counts for all projects
  useEffect(() => {
    let cancelled = false;

    const loadCounts = async () => {
      const counts: Record<string, number> = {};
      for (const project of projects) {
        try {
          const data = await window.electronAPI.whisperwoofGetProjectEntries(project.id, 0);
          if (cancelled) return;
          counts[project.id] = (data ?? []).length;
        } catch {
          counts[project.id] = 0;
        }
      }
      if (!cancelled) setEntryCounts(counts);
    };

    if (projects.length > 0) loadCounts();
    return () => { cancelled = true; };
  }, [projects]);

  const handleCreateProject = useCallback(async (name: string) => {
    try {
      const created = await window.electronAPI.whisperwoofCreateProject(name);
      if (created) {
        setProjects((prev) => [created, ...prev]);
        setSelectedId(created.id);
        setEntryCounts((prev) => ({ ...prev, [created.id]: 0 }));
        setIntegrations((prev) => ({ ...prev, [created.id]: null }));
      }
    } catch {
      setError("Failed to create project.");
    } finally {
      setIsCreating(false);
    }
  }, []);

  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      await window.electronAPI.whisperwoofDeleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
      setEntryCounts((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      setIntegrations((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } catch {
      setError("Failed to delete project.");
    }
  }, []);

  const handleSetIntegration = useCallback(async (projectId: string, pluginId: string | null) => {
    try {
      await window.electronAPI.whisperwoofUpdateProjectIntegration(projectId, pluginId);
      setIntegrations((prev) => ({ ...prev, [projectId]: pluginId }));
    } catch {
      setError("Failed to update integration.");
    }
  }, []);

  const handleDispatchEntry = useCallback(async (entryId: string, text: string) => {
    if (!selectedId) return;
    const pluginId = integrations[selectedId];
    if (!pluginId) return;
    const result = await window.electronAPI.whisperwoofDispatchEntry(entryId, pluginId, text);
    if (!result.success) {
      throw new Error(result.error ?? "Dispatch failed");
    }
  }, [selectedId, integrations]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;
  const selectedPluginId = selectedId ? integrations[selectedId] ?? null : null;
  const selectedPlugin = plugins.find((p) => p.id === selectedPluginId) ?? null;

  const getPluginName = (projectId: string): string | null => {
    const pluginId = integrations[projectId];
    if (!pluginId) return null;
    return plugins.find((p) => p.id === pluginId)?.name ?? null;
  };

  return (
    <div className={cn("flex h-full max-w-5xl mx-auto w-full", className)}>
      {/* Project list panel */}
      <div className="w-60 shrink-0 flex flex-col border-r border-border/15 dark:border-white/6">
        <div className="p-3 pb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground/80">Projects</span>
          <button
            onClick={() => setIsCreating(true)}
            className="p-1 rounded hover:bg-foreground/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="New Project"
          >
            <Plus size={15} />
          </button>
        </div>

        {isCreating && (
          <NewProjectInput
            onSubmit={handleCreateProject}
            onCancel={() => setIsCreating(false)}
          />
        )}

        <div className="flex-1 overflow-y-auto px-1.5">
          {isLoading && projects.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-4">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {!isLoading && !error && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
              <FolderOpen size={32} className="text-muted-foreground/25 mb-4" />
              <p className="text-sm font-medium text-foreground/70 mb-1.5">
                Projects — capture buckets for your voice
              </p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[240px] mb-4">
                Group voice entries by topic. Link a project to a plugin
                (Todoist, TickTick, etc.) to send captured text as tasks with one click.
              </p>
              <div className="rounded-lg border border-border/20 dark:border-white/6 bg-foreground/[0.02] dark:bg-white/[0.02] px-4 py-3 mb-5 max-w-[260px]">
                <p className="text-[11px] text-foreground/50 leading-relaxed">
                  <span className="font-medium text-foreground/70">Example:</span> Create
                  "Work Tasks" → link to Todoist → press <kbd className="px-1 py-0.5 rounded bg-foreground/5 dark:bg-white/5 text-[10px] font-mono">Fn+P</kbd> and
                  say "fix the login bug" → it becomes a Todoist task.
                </p>
              </div>
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 py-1.5 rounded-md bg-primary/8 hover:bg-primary/12 transition-colors"
              >
                <Plus size={12} />
                Create your first project
              </button>
            </div>
          )}

          {projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              isSelected={project.id === selectedId}
              entryCount={entryCounts[project.id]}
              integrationName={getPluginName(project.id)}
              onSelect={() => setSelectedId(project.id)}
              onDelete={() => handleDeleteProject(project.id)}
            />
          ))}
        </div>
      </div>

      {/* Entries panel */}
      <div className="flex-1 overflow-y-auto">
        {selectedProject ? (
          <div className="flex flex-col">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
              <h2 className="text-base font-medium text-foreground">{selectedProject.name}</h2>
              {/* Integration selector */}
              <IntegrationSelector
                plugins={plugins}
                currentPluginId={selectedPluginId}
                onSelect={(pluginId) => handleSetIntegration(selectedProject.id, pluginId)}
              />
            </div>
            {selectedPlugin && (
              <div className="px-4 pb-2">
                <p className="text-[11px] text-primary/60 flex items-center gap-1">
                  <Link2 size={10} />
                  Entries can be sent to {selectedPlugin.name}. Hover an entry and click <Send size={10} className="inline" /> to dispatch.
                </p>
              </div>
            )}
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center px-8">
                <FolderOpen size={28} className="text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No entries in this project yet. Use Fn+P to capture thoughts here.
                </p>
              </div>
            ) : (
              <div className="px-1.5">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    integrationPlugin={selectedPlugin}
                    onDispatch={handleDispatchEntry}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a project to view entries
          </div>
        )}
      </div>
    </div>
  );
}
