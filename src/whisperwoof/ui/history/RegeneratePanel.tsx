import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { getEffectiveReasoningModel, getSettings, isCloudReasoningMode } from "../../../stores/settingsStore";
import { resolveChineseScript } from "../../core/language/normalize-chinese-script";
import type { Entry } from "../../core/storage/types";
import type { RegenerateOptionsResult, RegenerateSttOption } from "../../../types/electron";
import {
  defaultCleanupChoice,
  defaultSttSelection,
  parseSelectionKey,
  selectionKey,
  type CleanupChoice,
} from "./regenerate-selections";
import { polishForRegeneration } from "./regenerate-polish";

/**
 * History → Regenerate: re-run a stored recording through a chosen STT model
 * and/or a chosen cleanup model, replacing the entry's text (undoable).
 *
 * STT runs in the main process (it owns the audio files and the engines);
 * cleanup runs here, through the same ReasoningService + output guard live
 * dictation uses.
 */

type Phase = "idle" | "transcribing" | "polishing" | "saving";

interface LocalModel {
  id: string;
  name?: string;
  isDownloaded?: boolean;
}

interface RegeneratePanelProps {
  readonly entry: Entry;
  readonly onUpdated: (entry: Entry) => void;
  readonly onClose: () => void;
}

const AUDIO_REASON_TEXT: Record<string, string> = {
  no_audio_link:
    "No recording is kept for this entry (data retention was off, or it predates audio linking). You can still re-run cleanup on the current transcript.",
  audio_deleted:
    "The recording for this entry has been deleted (audio is kept for 30 days). You can still re-run cleanup on the current transcript.",
};

function sttGroupLabel(engine: RegenerateSttOption["engine"]): string {
  return engine === "whisper" ? "Whisper" : "Parakeet · SenseVoice · Nemotron";
}

function sttItemLabel(item: RegenerateSttOption): string {
  if (!item.downloaded) return `${item.label} (not downloaded)`;
  if (!item.runnable) return `${item.label} (engine missing)`;
  return item.label;
}

export function RegeneratePanel({ entry, onUpdated, onClose }: RegeneratePanelProps) {
  const [options, setOptions] = useState<RegenerateOptionsResult | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sttKey, setSttKey] = useState<string>("keep");
  const [cleanup, setCleanup] = useState<CleanupChoice>("none");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const isCloud = useMemo(() => isCloudReasoningMode(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = window.electronAPI;
      try {
        const [opts, models] = await Promise.all([
          api.whisperwoofRegenerateOptions?.(entry.id),
          api.modelGetAll?.().catch(() => []) ?? Promise.resolve([]),
        ]);
        if (cancelled) return;
        if (!opts?.success) {
          setLoadError(opts?.error ?? "Could not load regeneration options.");
          return;
        }
        const downloaded = (models as LocalModel[]).filter((m) => m?.isDownloaded);
        setOptions(opts);
        setLocalModels(downloaded);
        const settings = getSettings();
        setSttKey(selectionKey(defaultSttSelection(settings, opts.stt ?? [], Boolean(opts.canRegenerateStt))));
        setCleanup(
          defaultCleanupChoice({
            useReasoningModel: settings.useReasoningModel,
            isCloud,
            effectiveModel: getEffectiveReasoningModel(),
            localModelIds: downloaded.map((m) => m.id),
          })
        );
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, isCloud]);

  const inventory = useMemo(() => options?.stt ?? [], [options]);
  const canRegenerateStt = Boolean(options?.canRegenerateStt);
  const selection = parseSelectionKey(sttKey);
  const nothingToDo = selection.engine === "keep" && cleanup === "none";
  const running = phase !== "idle";

  const run = useCallback(async () => {
    if (running || nothingToDo) return;
    setError(null);
    setSummary(null);
    const api = window.electronAPI;
    const settings = getSettings();
    const startedAt = Date.now();

    let rawText = entry.rawText ?? "";
    let stt: { engine: string; model: string } | null = null;
    const notes: string[] = [];

    try {
      if (selection.engine !== "keep" && selection.model) {
        setPhase("transcribing");
        const result = await api.whisperwoofRegenerateStt?.(entry.id, {
          engine: selection.engine,
          model: selection.model,
          language: settings.preferredLanguage,
          script: resolveChineseScript(settings.preferredLanguage, settings.uiLanguage, navigator.language),
        });
        if (!result?.success || typeof result.rawText !== "string") {
          setError(result?.error ?? "Transcription failed.");
          setPhase("idle");
          return;
        }
        rawText = result.rawText;
        const modelUsed = result.modelUsed ?? result.requestedModel ?? selection.model;
        stt = { engine: result.engine ?? selection.engine, model: modelUsed };
        notes.push(modelUsed);
        if (result.modelUsed && result.modelUsed !== result.requestedModel) {
          notes.push(`(substituted for ${result.requestedModel})`);
        }
      }

      if (!rawText.trim()) {
        setError("The recording produced no text.");
        setPhase("idle");
        return;
      }

      setPhase("polishing");
      let polished: string | null = null;
      let accepted = false;
      let reason: string | undefined;
      let detail: string | undefined;
      if (cleanup !== "none") {
        try {
          const polish = await polishForRegeneration(rawText, cleanup);
          polished = polish.polished;
          accepted = polish.accepted;
          reason = polish.reason;
          detail = polish.detail;
          notes.push(
            accepted
              ? cleanup === "cloud"
                ? "cloud cleanup"
                : cleanup.slice("local:".length)
              : `cleanup rejected: ${reason}${detail ? `/${detail}` : ""}`
          );
        } catch (err) {
          reason = (err as Error).message;
          notes.push(`cleanup failed: ${reason}`);
        }
      } else {
        notes.push("no cleanup");
      }

      setPhase("saving");
      const updated = await api.whisperwoofUpdateEntry?.(entry.id, {
        rawText,
        polished,
        stt,
        cleanup: { choice: cleanup, accepted, reason, detail },
      });
      if (!updated?.success || !updated.entry) {
        setError(updated?.error ?? "Could not save the regenerated text.");
        setPhase("idle");
        return;
      }
      onUpdated(updated.entry as Entry);
      setSummary(`${notes.join(" · ")} · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase("idle");
    }
  }, [cleanup, entry.id, entry.rawText, nothingToDo, onUpdated, running, selection.engine, selection.model]);

  const phaseText =
    phase === "transcribing"
      ? "Transcribing…"
      : phase === "polishing"
        ? "Cleaning up…"
        : phase === "saving"
          ? "Saving…"
          : null;

  const grouped = useMemo(() => {
    const byEngine = new Map<RegenerateSttOption["engine"], RegenerateSttOption[]>();
    for (const item of inventory) {
      const list = byEngine.get(item.engine) ?? [];
      list.push(item);
      byEngine.set(item.engine, list);
    }
    return byEngine;
  }, [inventory]);

  return (
    <div className="rounded-lg bg-card shadow-card p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Regenerate this entry</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-foreground/5 text-muted-foreground"
          aria-label="Close"
          disabled={running}
        >
          <X size={13} />
        </button>
      </div>

      {loadError && <p className="text-xs text-destructive">{loadError}</p>}

      {options && !canRegenerateStt && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {AUDIO_REASON_TEXT[options.audioReason ?? "no_audio_link"]}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Transcribe with</span>
          <Select value={sttKey} onValueChange={setSttKey} disabled={running || !options}>
            <SelectTrigger className="h-8 text-xs rounded-md">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep" className="text-xs">
                Keep current transcript
              </SelectItem>
              {Array.from(grouped.entries()).map(([engine, items]) => (
                <SelectGroup key={engine}>
                  <SelectLabel className="text-[11px]">{sttGroupLabel(engine)}</SelectLabel>
                  {items.map((item) => (
                    <SelectItem
                      key={`${item.engine}:${item.model}`}
                      value={`${item.engine}:${item.model}`}
                      disabled={!canRegenerateStt || !item.runnable}
                      className="text-xs"
                    >
                      {sttItemLabel(item)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Clean up with</span>
          <Select
            value={cleanup}
            onValueChange={(v) => setCleanup(v as CleanupChoice)}
            disabled={running || !options}
          >
            <SelectTrigger className="h-8 text-xs rounded-md">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">
                None (raw transcript)
              </SelectItem>
              {isCloud && (
                <SelectItem value="cloud" className="text-xs">
                  Cloud cleanup (current)
                </SelectItem>
              )}
              {localModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[11px]">Local models</SelectLabel>
                  {localModels.map((m) => (
                    <SelectItem key={m.id} value={`local:${m.id}`} className="text-xs">
                      {m.name ?? m.id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={run} disabled={running || nothingToDo || !options} className="gap-1.5">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {phaseText ?? "Run"}
        </Button>
        {nothingToDo && !running && (
          <span className="text-[11px] text-muted-foreground">Pick a transcription model or a cleanup model.</span>
        )}
        {summary && !running && <span className="text-[11px] text-muted-foreground">{summary}</span>}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Switching models restarts the local engine; the next dictation reloads your configured models.
      </p>
    </div>
  );
}
