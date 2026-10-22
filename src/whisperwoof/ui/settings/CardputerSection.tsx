import React, { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Toggle } from "../../../components/ui/toggle";
import {
  SettingsSection,
  SettingsGroup,
  SettingsRow,
} from "../../../components/ui/SettingsSection";

/** What main says about the Cardputer inbox (bridge/cardputer-inbox.js). */
interface CardputerInboxState {
  readonly enabled: boolean;
  readonly root: string;
}

// Cardputer electronAPI methods (exposed in preload.js). The folder is picked
// in main's native dialog: this page never sends a path.
interface CardputerAPI {
  whisperwoofCardputerGet?: () => Promise<CardputerInboxState>;
  whisperwoofCardputerSetEnabled?: (enabled: boolean) => Promise<CardputerInboxState>;
  whisperwoofCardputerPickRoot?: () => Promise<
    { success: boolean; canceled?: boolean } & Partial<CardputerInboxState>
  >;
  openExternal?: (url: string) => Promise<void>;
}

function getAPI(): CardputerAPI | undefined {
  return (window as unknown as { electronAPI?: CardputerAPI }).electronAPI;
}

/**
 * Settings → WhisperWoof → Cardputer recordings: turn the inbox on (it is off
 * by default) and choose the folder cardputer-assistant's daemon saves to.
 */
export default function CardputerSection() {
  const [state, setState] = useState<CardputerInboxState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAPI()
      ?.whisperwoofCardputerGet?.()
      .then((next) => {
        if (!cancelled && next) setState({ enabled: next.enabled, root: next.root });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read the Cardputer setting.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(async (checked: boolean) => {
    try {
      const next = await getAPI()?.whisperwoofCardputerSetEnabled?.(checked);
      if (next) setState({ enabled: next.enabled, root: next.root });
      setError(null);
    } catch {
      setError("Couldn't change the Cardputer setting.");
    }
  }, []);

  const handlePickFolder = useCallback(async () => {
    try {
      const result = await getAPI()?.whisperwoofCardputerPickRoot?.();
      if (result?.success && typeof result.root === "string") {
        setState({ enabled: result.enabled === true, root: result.root });
      }
      setError(null);
    } catch {
      setError("Couldn't change the folder.");
    }
  }, []);

  const root = state?.root;
  const handleOpenFolder = useCallback(async () => {
    if (!root) return;
    try {
      await getAPI()?.openExternal?.(`file://${root}`);
    } catch {
      // The folder may not exist yet: nothing to open
    }
  }, [root]);

  return (
    <SettingsSection title="Cardputer recordings">
      <SettingsGroup>
        <SettingsRow
          label="Transcribe Cardputer recordings"
          description="Voice memos and meetings from your Cardputer become transcripts on this Mac, with SenseVoice."
        >
          <Toggle checked={state?.enabled ?? false} onChange={handleToggle} disabled={!state} />
        </SettingsRow>
        <SettingsRow
          label="Recordings folder"
          description="Where the Cardputer daemon (cpad) saves recordings."
        >
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePickFolder}
              disabled={!state}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Change Folder
            </button>
            <button
              onClick={handleOpenFolder}
              disabled={!state}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-foreground border border-border hover:bg-foreground/5 transition-colors disabled:opacity-50"
            >
              <FolderOpen size={13} />
              Open
            </button>
          </div>
        </SettingsRow>
        <p className="text-xs text-muted-foreground/70 font-mono truncate" title={state?.root}>
          {state ? state.root : "Loading..."}
        </p>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          Recordings, transcripts and summaries in this folder are plain files: WhisperWoof's
          encryption doesn't cover them. Tell the people present before you record a meeting.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </SettingsGroup>
    </SettingsSection>
  );
}
