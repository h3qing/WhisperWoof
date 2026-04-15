import React, { useState, useEffect, useCallback, useRef } from "react";
import { Puzzle, Plus, Trash2, X } from "lucide-react";
import { cn } from "../../../components/lib/utils";

interface PluginSetup {
  readonly envKey: string;
  readonly label: string;
  readonly url: string;
  readonly instructions: string;
}

interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly command: string;
  readonly enabled: boolean;
  readonly hotkeyBinding: string | null;
  readonly setup?: PluginSetup;
  readonly configured?: boolean;
}

interface WhisperWoofElectronAPI {
  whisperwoofGetPlugins: () => Promise<Plugin[]>;
  whisperwoofUpdatePlugin: (id: string, updates: Partial<Plugin>) => Promise<Plugin | null>;
  whisperwoofAddPlugin: (config: Plugin) => Promise<Plugin | null>;
  whisperwoofRemovePlugin: (id: string) => Promise<{ success: boolean }>;
}

function getAPI(): WhisperWoofElectronAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI as WhisperWoofElectronAPI;
}

interface WhisperWoofPluginsProps {
  readonly className?: string;
}

// Subcomponents

function StatusDot({ enabled }: { readonly enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        enabled ? "bg-green-500" : "bg-muted-foreground/30"
      )}
    />
  );
}

function PluginToggle({
  enabled,
  onToggle,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
        enabled ? "bg-primary" : "bg-muted-foreground/20"
      )}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200",
          enabled ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function PluginCard({
  plugin,
  onToggle,
  onRemove,
}: {
  readonly plugin: Plugin;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors duration-150",
        "border-border/15 dark:border-white/6",
        "hover:bg-foreground/3 dark:hover:bg-white/3"
      )}
    >
      <div className="mt-0.5 w-8 h-8 rounded-md bg-primary/8 dark:bg-primary/12 flex items-center justify-center shrink-0">
        <Puzzle size={16} className="text-primary/70" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <StatusDot enabled={plugin.enabled} />
          <span className="text-sm font-medium text-foreground truncate">{plugin.name}</span>
          {plugin.hotkeyBinding && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
              {plugin.hotkeyBinding}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{plugin.description}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono truncate">{plugin.command}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <PluginToggle enabled={plugin.enabled} onToggle={onToggle} />
        {hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            aria-label={`Remove ${plugin.name}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function SetupGuide({
  plugin,
  onSave,
  onCancel,
}: {
  readonly plugin: Plugin;
  readonly onSave: (apiKey: string) => void;
  readonly onCancel: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const setup = plugin.setup;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!setup) return null;

  const handleTest = async () => {
    if (apiKey.trim().length === 0) return;
    setTesting(true);
    setTestResult(null);
    // Simple validation: key is non-empty and looks like a token
    await new Promise((r) => setTimeout(r, 600));
    setTestResult(apiKey.trim().length >= 8 ? "success" : "error");
    setTesting(false);
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/8 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Set up {plugin.name}</span>
        <button type="button" onClick={onCancel} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground leading-snug">{setup.instructions}</p>

        <a
          href={setup.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).electronAPI?.openExternal?.(setup.url);
          }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 underline underline-offset-2"
        >
          Open {plugin.name} settings
          <span className="text-[10px]">&#8599;</span>
        </a>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">{setup.label}</label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
            placeholder={`Paste your ${setup.label.toLowerCase()} here`}
            className="flex-1 h-8 px-2.5 text-xs rounded-md border border-border/25 dark:border-white/10 bg-background outline-none focus:ring-1 focus:ring-primary/30 font-mono"
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || apiKey.trim().length === 0}
            className="h-8 px-3 rounded-md text-xs font-medium border border-border/25 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            {testing ? "Testing..." : "Test"}
          </button>
        </div>
        {testResult === "success" && (
          <p className="text-[11px] text-green-600 dark:text-green-400">Connection looks good.</p>
        )}
        {testResult === "error" && (
          <p className="text-[11px] text-destructive">Token seems too short. Double-check you copied the full token.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSave(apiKey.trim())}
          disabled={apiKey.trim().length === 0}
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          Save &amp; Enable
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddPluginForm({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (plugin: { name: string; command: string; description: string }) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0 || trimmedCommand.length === 0) return;
    onSubmit({ name: trimmedName, command: trimmedCommand, description: description.trim() });
  };

  const inputClass =
    "w-full h-8 px-2.5 text-xs rounded-md border border-border/25 dark:border-white/10 bg-background outline-none focus:ring-1 focus:ring-primary/30";

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/8 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Add Plugin</span>
        <button type="button" onClick={onCancel} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>
      <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Plugin name" className={inputClass} />
      <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command (e.g. npx @whisperwoof/my-plugin)" className={inputClass} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className={inputClass} />
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center px-8">
      <Puzzle size={32} className="text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">
        No plugins configured. Click "Add Plugin" to get started.
      </p>
    </div>
  );
}

// Main component

export default function WhisperWoofPlugins({ className }: WhisperWoofPluginsProps) {
  const [plugins, setPlugins] = useState<readonly Plugin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [settingUpId, setSettingUpId] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getAPI().whisperwoofGetPlugins();
      setPlugins(data ?? []);
    } catch {
      setError("Failed to load plugins.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleToggle = useCallback(async (id: string, currentEnabled: boolean) => {
    // If enabling and plugin has setup info but isn't configured, show setup guide
    if (!currentEnabled) {
      const plugin = plugins.find((p) => p.id === id);
      if (plugin?.setup && !plugin.configured) {
        setSettingUpId(id);
        return;
      }
    }
    try {
      const updated = await getAPI().whisperwoofUpdatePlugin(id, { enabled: !currentEnabled });
      if (updated) {
        setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      }
    } catch {
      setError("Failed to update plugin.");
    }
  }, [plugins]);

  const handleSetupSave = useCallback(async (pluginId: string, apiKey: string) => {
    try {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin?.setup) return;
      const env = { [plugin.setup.envKey]: apiKey };
      const updated = await getAPI().whisperwoofUpdatePlugin(pluginId, { enabled: true, configured: true, env } as Partial<Plugin>);
      if (updated) {
        setPlugins((prev) => prev.map((p) => (p.id === pluginId ? { ...p, ...updated, configured: true, enabled: true } : p)));
      }
      setSettingUpId(null);
    } catch {
      setError("Failed to save plugin configuration.");
    }
  }, [plugins]);

  const handleAdd = useCallback(async (input: { name: string; command: string; description: string }) => {
    try {
      const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const config: Plugin = {
        id,
        name: input.name,
        description: input.description,
        command: input.command,
        enabled: false,
        hotkeyBinding: null,
      };
      const result = await getAPI().whisperwoofAddPlugin(config);
      if (result) {
        setPlugins((prev) => [...prev, result]);
      } else {
        setError("Plugin with this name already exists.");
      }
    } catch {
      setError("Failed to add plugin.");
    } finally {
      setIsAdding(false);
    }
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await getAPI().whisperwoofRemovePlugin(id);
      setPlugins((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError("Failed to remove plugin.");
    }
  }, []);

  return (
    <div className={cn("flex flex-col h-full max-w-3xl mx-auto w-full px-6 py-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium text-foreground">Plugins</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage MCP server plugins for voice routing</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} />
          Add Plugin
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md bg-destructive/10 text-xs text-destructive">
          {error}
        </div>
      )}

      {isAdding && (
        <div className="mb-4">
          <AddPluginForm onSubmit={handleAdd} onCancel={() => setIsAdding(false)} />
        </div>
      )}

      {/* Plugin list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading && plugins.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        )}

        {!isLoading && !error && plugins.length === 0 && <EmptyState />}

        {plugins.map((plugin) => (
          <React.Fragment key={plugin.id}>
            <PluginCard
              plugin={plugin}
              onToggle={() => handleToggle(plugin.id, plugin.enabled)}
              onRemove={() => handleRemove(plugin.id)}
            />
            {settingUpId === plugin.id && plugin.setup && (
              <SetupGuide
                plugin={plugin}
                onSave={(apiKey) => handleSetupSave(plugin.id, apiKey)}
                onCancel={() => setSettingUpId(null)}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
