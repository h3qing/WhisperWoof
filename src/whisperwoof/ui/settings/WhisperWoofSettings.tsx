import React, { useState, useEffect, useCallback } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import { Toggle } from "../../../components/ui/toggle";
import {
  SettingsSection,
  SettingsGroup,
  SettingsRow,
} from "../../../components/ui/SettingsSection";

// WhisperWoof-specific electronAPI methods (exposed in preload.js).
interface WhisperWoofSettingsAPI {
  whisperwoofOllamaCheck: () => Promise<{ available: boolean; models: string[] }>;
  whisperwoofClipboardToggle: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  whisperwoofGetNotesDir: () => Promise<{ success: boolean; path?: string; error?: string }>;
  openExternal: (url: string) => Promise<void>;
}

function getAPI(): WhisperWoofSettingsAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI as WhisperWoofSettingsAPI;
}

// State held as a single immutable snapshot, replaced on each update.
interface OllamaStatus {
  readonly checking: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
}

interface PolishPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface SettingsState {
  readonly polishEnabled: boolean;
  readonly ollamaModel: string;
  readonly ollama: OllamaStatus;
  readonly polishPreset: string;
  readonly presets: readonly PolishPreset[];
  readonly customPrompt: string;
  readonly clipboardEnabled: boolean;
  readonly liveTranscriptEnabled: boolean;
  readonly notesDir: string;
  readonly notesDirLoading: boolean;
}

function buildInitialState(): SettingsState {
  return {
    polishEnabled: localStorage.getItem("whisperwoof-polish-enabled") !== "false",
    ollamaModel: localStorage.getItem("whisperwoof-ollama-model") || "llama3.2:1b",
    ollama: { checking: true, available: false, models: [] },
    polishPreset: localStorage.getItem("whisperwoof-polish-preset") || "clean",
    presets: [],
    customPrompt: localStorage.getItem("whisperwoof-custom-prompt") || "",
    clipboardEnabled: localStorage.getItem("whisperwoof-clipboard-enabled") !== "false",
    liveTranscriptEnabled: localStorage.getItem("whisperwoof-live-transcript") !== "false",
    notesDir: "",
    notesDirLoading: true,
  };
}

interface WhisperWoofSettingsProps {
  readonly className?: string;
}

export default function WhisperWoofSettings({ className }: WhisperWoofSettingsProps) {
  const [state, setState] = useState<SettingsState>(buildInitialState);

  // Check Ollama availability on mount
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const result = await getAPI().whisperwoofOllamaCheck();
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            ollama: { checking: false, available: result.available, models: result.models ?? [] },
          }));
        }
      } catch {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            ollama: { checking: false, available: false, models: [] },
          }));
        }
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // Load polish presets on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const api = (window as any).electronAPI;
        const presets = await api?.whisperwoofGetPolishPresets?.();
        if (!cancelled && presets) {
          setState((prev) => ({ ...prev, presets }));
        }
      } catch { /* ignore */ }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Fetch notes directory on mount
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const result = await getAPI().whisperwoofGetNotesDir();
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            notesDir: result.success && result.path ? result.path : "Unknown",
            notesDirLoading: false,
          }));
        }
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, notesDir: "Error loading path", notesDirLoading: false }));
        }
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  const handlePolishToggle = useCallback((checked: boolean) => {
    localStorage.setItem("whisperwoof-polish-enabled", String(checked));
    setState((prev) => ({ ...prev, polishEnabled: checked }));
  }, []);

  const handleModelChange = useCallback((value: string) => {
    localStorage.setItem("whisperwoof-ollama-model", value);
    setState((prev) => ({ ...prev, ollamaModel: value }));
  }, []);

  const handlePresetChange = useCallback((presetId: string) => {
    localStorage.setItem("whisperwoof-polish-preset", presetId);
    setState((prev) => ({ ...prev, polishPreset: presetId }));
  }, []);

  const handleClipboardToggle = useCallback(async (checked: boolean) => {
    try {
      await getAPI().whisperwoofClipboardToggle(checked);
      localStorage.setItem("whisperwoof-clipboard-enabled", String(checked));
      setState((prev) => ({ ...prev, clipboardEnabled: checked }));
    } catch {
      // Toggle failed — keep previous state
    }
  }, []);

  const handleLiveTranscriptToggle = useCallback((checked: boolean) => {
    localStorage.setItem("whisperwoof-live-transcript", String(checked));
    setState((prev) => ({ ...prev, liveTranscriptEnabled: checked }));
  }, []);

  const handleOpenNotesFolder = useCallback(async () => {
    if (state.notesDir && state.notesDir !== "Unknown" && state.notesDir !== "Error loading path") {
      try {
        await getAPI().openExternal(`file://${state.notesDir}`);
      } catch {
        // Failed to open — silently ignore
      }
    }
  }, [state.notesDir]);

  const ollamaStatusText = state.ollama.checking
    ? "Checking..."
    : state.ollama.available
      ? `Ollama running (${state.ollama.models.length} model${state.ollama.models.length !== 1 ? "s" : ""})`
      : "Ollama not detected";

  const ollamaStatusColor = state.ollama.checking
    ? "text-muted-foreground"
    : state.ollama.available
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground/60";

  return (
    <div className={cn("max-w-2xl mx-auto w-full space-y-6 p-6", className)}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">WhisperWoof</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Voice capture, clipboard monitoring, and local AI polish.
        </p>
      </div>

      {/* Polish (Ollama) */}
      <SettingsSection title="Polish (Ollama)">
        <SettingsGroup>
          <SettingsRow label="Enable polish" description="Polish transcriptions with a local LLM via Ollama.">
            <Toggle
              checked={state.polishEnabled}
              onChange={handlePolishToggle}
              disabled={state.ollama.checking}
            />
          </SettingsRow>

          <div className="flex items-center gap-2">
            {state.ollama.checking && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            <span className={`text-xs ${ollamaStatusColor}`}>{ollamaStatusText}</span>
          </div>

          <SettingsRow label="Style" description="How your transcriptions get cleaned up.">
            <select
              value={state.polishPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="h-7 w-40 rounded-md border border-border/50 dark:border-white/10 bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            >
              {state.presets.length > 0 ? (
                state.presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))
              ) : (
                <>
                  <option value="clean">Clean</option>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="minimal">Minimal</option>
                  <option value="structured">Structured</option>
                </>
              )}
            </select>
          </SettingsRow>

          {state.presets.length > 0 && (
            <p className="text-xs text-muted-foreground/70">
              {state.presets.find((p) => p.id === state.polishPreset)?.description ?? ""}
            </p>
          )}

          <SettingsRow label="Model" description="Ollama model used for text polish.">
            <input
              type="text"
              value={state.ollamaModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="h-7 w-40 rounded-md border border-border/50 dark:border-white/10 bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </SettingsRow>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              Custom instructions <span className="text-muted-foreground/50 font-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-muted-foreground/60">
              Added to every polish request. Example: "Write in first person" or "Keep it under 2 sentences"
            </p>
            <textarea
              value={state.customPrompt}
              onChange={(e) => {
                const val = e.target.value;
                localStorage.setItem("whisperwoof-custom-prompt", val);
                setState((prev) => ({ ...prev, customPrompt: val }));
              }}
              rows={2}
              placeholder="e.g. Always use active voice. Remove hedging language like 'I think' and 'maybe'."
              className="w-full rounded-md border border-border/50 dark:border-white/10 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>
        </SettingsGroup>
      </SettingsSection>

      {/* Clipboard */}
      <SettingsSection title="Clipboard">
        <SettingsGroup>
          <SettingsRow label="Enable clipboard monitoring" description="Capture clipboard text to build searchable history.">
            <Toggle
              checked={state.clipboardEnabled}
              onChange={handleClipboardToggle}
            />
          </SettingsRow>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Captures clipboard text to build searchable history. Passwords from password managers are never captured.
          </p>
        </SettingsGroup>
      </SettingsSection>

      {/* Notes (Fn+N) */}
      <SettingsSection title="Notes (Fn+N)">
        <SettingsGroup>
          <SettingsRow label="Notes directory" description="Markdown files saved here. Point to your Obsidian vault or iCloud folder.">
            <div className="flex items-center gap-1.5">
              <button
                onClick={async () => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const api = (window as any).electronAPI;
                  const result = await api?.whisperwoofPickNotesDir?.();
                  if (result?.success) {
                    setState((prev) => ({ ...prev, notesDir: result.path }));
                  }
                }}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
              >
                Change Folder
              </button>
              <button
                onClick={handleOpenNotesFolder}
                disabled={state.notesDirLoading}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-foreground border border-border/50 dark:border-white/10 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <FolderOpen size={13} />
                Open
              </button>
            </div>
          </SettingsRow>
          <p className="text-xs text-muted-foreground/70 font-mono truncate" title={state.notesDir}>
            {state.notesDirLoading ? "Loading..." : state.notesDir}
          </p>
        </SettingsGroup>
      </SettingsSection>

      {/* Indicator */}
      <SettingsSection title="Indicator">
        <SettingsGroup>
          <SettingsRow label="Show live transcript" description="Display streaming text in the floating indicator while you speak.">
            <Toggle
              checked={state.liveTranscriptEnabled}
              onChange={handleLiveTranscriptToggle}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      {/* Storage */}
      <SettingsSection title="Storage">
        <SettingsGroup>
          <SettingsRow label="Entry history" description="Voice and clipboard entries stored locally in SQLite.">
            <span className="text-xs text-muted-foreground">View History</span>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      {/* Setup */}
      <SettingsSection title="Setup">
        <SettingsGroup>
          <SettingsRow label="Re-run onboarding" description="Walk through the setup wizard again (microphone, model, hotkey).">
            <button
              onClick={() => {
                localStorage.setItem("onboardingCurrentStep", "0");
                localStorage.removeItem("onboardingCompleted");
                window.location.reload();
              }}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-foreground border border-border/50 dark:border-white/10 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            >
              Restart Setup
            </button>
          </SettingsRow>
          <SettingsRow label="Version" description="WhisperWoof version number.">
            <span className="text-xs text-muted-foreground font-mono">v0.7.0</span>
          </SettingsRow>
          <SettingsRow label="Debug mode" description="Show pipeline timing (STT + polish) after each transcription.">
            <Toggle
              checked={localStorage.getItem("whisperwoof-debug") === "true"}
              onChange={(checked) => {
                localStorage.setItem("whisperwoof-debug", String(checked));
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
