import React, { useState, useEffect, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { cn } from "../../../components/lib/utils";
import { Toggle } from "../../../components/ui/toggle";
import {
  SettingsSection,
  SettingsGroup,
  SettingsRow,
} from "../../../components/ui/SettingsSection";
import { useSettingsStore } from "../../../stores/settingsStore";

// WhisperWoof-specific electronAPI methods (exposed in preload.js).
interface WhisperWoofSettingsAPI {
  whisperwoofClipboardToggle: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  whisperwoofGetNotesDir: () => Promise<{ success: boolean; path?: string; error?: string }>;
  openExternal: (url: string) => Promise<void>;
}

function getAPI(): WhisperWoofSettingsAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI as WhisperWoofSettingsAPI;
}

interface SettingsState {
  readonly clipboardEnabled: boolean;
  readonly liveTranscriptEnabled: boolean;
  readonly notesDir: string;
  readonly notesDirLoading: boolean;
}

function buildInitialState(): SettingsState {
  return {
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
  const autoPasteEnabled = useSettingsStore((s) => s.autoPasteEnabled);
  const setAutoPasteEnabled = useSettingsStore((s) => s.setAutoPasteEnabled);

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

  return (
    <div className={cn("max-w-2xl mx-auto w-full space-y-6 p-6", className)}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">WhisperWoof</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Voice capture, clipboard monitoring, and notes.
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-1.5">
          Text cleanup is configured in <span className="font-medium">Intelligence</span>.
        </p>
      </div>

      {/* Clipboard */}
      <SettingsSection title="Clipboard">
        <SettingsGroup>
          <SettingsRow label="Auto-paste after dictation" description="When off, transcribed text is not pasted at the cursor; copy it from history if needed.">
            <Toggle
              checked={autoPasteEnabled}
              onChange={setAutoPasteEnabled}
            />
          </SettingsRow>
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
            <span className="text-xs text-muted-foreground font-mono">v1.13.0</span>
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
