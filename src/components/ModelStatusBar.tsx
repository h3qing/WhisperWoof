import React from "react";
import { Mic, Sparkles, ChevronRight, Cloud, Lock } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import registry from "../models/modelRegistryData.json";

const CLOUD_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  groq: "Groq",
  custom: "Custom",
  openwhispr: "Cloud",
};

function whisperDisplayName(id: string): string {
  const m = (registry as any).whisperModels?.[id];
  return m?.name ? `Whisper ${m.name}` : id ? `Whisper ${id}` : "Whisper";
}

function parakeetDisplayName(id: string): string {
  return (registry as any).parakeetModels?.[id]?.name || "Parakeet";
}

function localReasoningDisplayName(id: string): string {
  for (const p of (registry as any).localProviders || []) {
    const m = (p.models || []).find((x: { id: string }) => x.id === id);
    if (m) return m.name;
  }
  return id || "Local model";
}

interface Props {
  onOpenSettings: (section?: string) => void;
}

/**
 * Compact "what's running" indicator for the home view: shows the active
 * speech-to-text model and the active cleanup (polish) model, each with a
 * one-line description. Clicking a pill jumps to the relevant Settings section.
 */
export default function ModelStatusBar({ onOpenSettings }: Props) {
  const {
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    useReasoningModel,
    reasoningProvider,
    reasoningModel,
  } = useSettings();

  // --- Speech-to-text ---
  let sttName: string;
  let sttDesc: string;
  let sttLocal = true;
  if (!useLocalWhisper) {
    sttLocal = false;
    sttName = cloudTranscriptionModel || CLOUD_LABEL[cloudTranscriptionProvider] || "Cloud";
    sttDesc = `${CLOUD_LABEL[cloudTranscriptionProvider] || "Cloud"} · sent to the cloud`;
  } else if (localTranscriptionProvider === "nvidia") {
    sttName = parakeetDisplayName(parakeetModel);
    sttDesc = "On-device · fast, multilingual";
  } else {
    sttName = whisperDisplayName(whisperModel);
    sttDesc = "On-device";
  }

  // --- Cleanup (polish) ---
  const polishOn = useReasoningModel && !!reasoningModel;
  let polishName: string;
  let polishDesc: string;
  let polishLocal = true;
  if (!useReasoningModel) {
    polishName = "Off";
    polishDesc = "Raw transcript, no cleanup";
    polishLocal = true;
  } else if (!reasoningModel && reasoningProvider === "local") {
    polishName = "Not set up";
    polishDesc = "Pick a model in Settings";
  } else if (reasoningProvider === "local") {
    polishName = localReasoningDisplayName(reasoningModel);
    polishDesc = "On-device · removes fillers, fixes grammar";
  } else {
    polishLocal = false;
    polishName = reasoningModel || CLOUD_LABEL[reasoningProvider] || "Cloud";
    polishDesc = `${CLOUD_LABEL[reasoningProvider] || "Cloud"} · sent to the cloud`;
  }

  const pill =
    "group flex items-center gap-2.5 rounded-lg border border-border bg-card/50 dark:bg-card/60 backdrop-blur-sm px-3 py-2 text-left transition-colors hover:border-border/80 hover:bg-card/80";

  return (
    <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button className={pill} onClick={() => onOpenSettings("transcription")} title="Change speech-to-text model">
        <div className="shrink-0 w-7 h-7 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
          <Mic size={14} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Speech-to-text
            </span>
            {sttLocal ? (
              <Lock size={9} className="text-emerald-500" />
            ) : (
              <Cloud size={9} className="text-sky-500" />
            )}
          </div>
          <div className="text-xs font-medium text-foreground truncate">{sttName}</div>
          <div className="text-[10px] text-muted-foreground truncate">{sttDesc}</div>
        </div>
        <ChevronRight size={14} className="text-muted-foreground/50 group-hover:text-muted-foreground shrink-0" />
      </button>

      <button className={pill} onClick={() => onOpenSettings("intelligence")} title="Change cleanup model">
        <div
          className={
            "shrink-0 w-7 h-7 rounded-md flex items-center justify-center " +
            (polishOn ? "bg-primary/10 dark:bg-primary/20" : "bg-muted")
          }
        >
          <Sparkles size={14} className={polishOn ? "text-primary" : "text-muted-foreground"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cleanup
            </span>
            {polishOn && (polishLocal ? (
              <Lock size={9} className="text-emerald-500" />
            ) : (
              <Cloud size={9} className="text-sky-500" />
            ))}
          </div>
          <div className="text-xs font-medium text-foreground truncate">{polishName}</div>
          <div className="text-[10px] text-muted-foreground truncate">{polishDesc}</div>
        </div>
        <ChevronRight size={14} className="text-muted-foreground/50 group-hover:text-muted-foreground shrink-0" />
      </button>
    </div>
  );
}
