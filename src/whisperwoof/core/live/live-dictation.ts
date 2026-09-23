/**
 * Live dictation: a streaming (online) model types provisional text into the
 * indicator while the user speaks; on release the final text comes either from
 * that stream or from a second, full-capture pass with the user's regular
 * transcription model — then the usual polish + paste.
 *
 * Pure so the routing matrix and the panel's phases are unit-testable; the
 * registry/language lookups arrive as deps.
 */
export type DictationMode = "live" | "batch";
/** "preview" = paste the streamed text; "transcription" = re-decode with the transcription model. */
export type LiveFinalPass = "preview" | "transcription";

// 160ms chunks: first words ~0.2s sooner and updates several times a second;
// on the owner's real dictations it was also slightly more accurate than 480ms
// (2.3% vs 2.8% MER) at the cost of a few more visible rewrites.
export const DEFAULT_LIVE_PREVIEW_MODEL = "x-asr-zh-en-streaming-160ms";

export interface LivePlanSettings {
  useLocalWhisper: boolean;
  localTranscriptionProvider: string;
  parakeetModel: string;
  preferredLanguage: string;
  dictationMode: string;
  livePreviewModel: string;
  liveFinalPass: string;
}

export interface LivePlanDeps {
  isOnlineModel: (modelId: string) => boolean;
  /** `language` is the base code ("zh"), undefined for auto-detect. */
  supportsLanguage: (language: string | undefined, modelId: string) => boolean;
}

export interface LivePlan {
  /** Show the live panel (the user chose live mode). */
  live: boolean;
  /** Tap the mic into a streaming server. */
  stream: boolean;
  previewModel: string | null;
  /** Paste the streamed text instead of re-decoding the recording. */
  useStreamedAsFinal: boolean;
}

const NO_STREAM = { stream: false, previewModel: null, useStreamedAsFinal: false } as const;

function baseLanguage(preferred: string): string | undefined {
  if (!preferred || preferred === "auto") return undefined;
  return preferred.split("-")[0].toLowerCase();
}

export function resolveLiveDictationPlan(s: LivePlanSettings, deps: LivePlanDeps): LivePlan {
  if (!s.useLocalWhisper) return { live: false, ...NO_STREAM };

  const language = baseLanguage(s.preferredLanguage);
  const usesParakeet = s.localTranscriptionProvider === "nvidia";

  if (s.dictationMode !== "live") {
    // Legacy: an online model picked as *the* transcription model streams and
    // its committed text is the final — batch decode only on a failed flush.
    const legacy =
      usesParakeet &&
      deps.isOnlineModel(s.parakeetModel) &&
      deps.supportsLanguage(language, s.parakeetModel);
    return legacy
      ? { live: false, stream: true, previewModel: s.parakeetModel, useStreamedAsFinal: true }
      : { live: false, ...NO_STREAM };
  }

  // A streaming transcription model previews itself: both roles share the one
  // streaming server, so a different preview model would swap models on it
  // every capture (two cold loads per dictation).
  const transcriptionModelStreams = usesParakeet && deps.isOnlineModel(s.parakeetModel);
  const previewModel = transcriptionModelStreams
    ? s.parakeetModel
    : deps.isOnlineModel(s.livePreviewModel)
      ? s.livePreviewModel
      : DEFAULT_LIVE_PREVIEW_MODEL;
  // Without a stream nothing would ever appear in the panel — use the regular indicator.
  if (!deps.supportsLanguage(language, previewModel)) return { live: false, ...NO_STREAM };

  return {
    live: true,
    stream: true,
    previewModel,
    useStreamedAsFinal: s.liveFinalPass === "preview" || transcriptionModelStreams,
  };
}

export type LivePanelPhase =
  | "hidden"
  | "listening"
  | "streaming"
  | "correcting"
  | "polishing"
  | "done";

/** `text` is committed + partial already joined by the main process (CJK-aware). */
export interface LiveSegments {
  text: string;
  committed: string;
  partial: string;
}

export const EMPTY_LIVE_SEGMENTS: LiveSegments = Object.freeze({
  text: "",
  committed: "",
  partial: "",
});

/** Stream payloads are `{text, committed, partial}`; cloud providers send a bare string. */
export function toLiveSegments(payload: unknown): LiveSegments {
  if (typeof payload === "string") return { text: payload, committed: "", partial: payload };
  if (!payload || typeof payload !== "object") return EMPTY_LIVE_SEGMENTS;
  const p = payload as Partial<LiveSegments>;
  const committed = String(p.committed ?? "");
  const partial = String(p.partial ?? "");
  return { text: String(p.text ?? `${committed}${partial}`), committed, partial };
}

export interface LivePanelInput {
  isRecording: boolean;
  isProcessing: boolean;
  processingPhase: string;
  segments: LiveSegments;
  /** Set briefly after a capture lands, so the panel can show what was pasted. */
  finalText: string;
}

export interface LivePanelView {
  phase: LivePanelPhase;
  committed: string;
  partial: string;
}

export function deriveLivePanelView(input: LivePanelInput): LivePanelView {
  const { text, committed, partial } = input.segments;
  if (input.isRecording) {
    if (!committed && !partial) return { phase: "listening", committed: "", partial: "" };
    // `text` carries the seam the main process chose (space for English, none
    // for CJK); take the committed side from it so the tail doesn't glue on.
    const committedWithSeam =
      partial && text.endsWith(partial) ? text.slice(0, text.length - partial.length) : committed;
    return { phase: "streaming", committed: committedWithSeam, partial };
  }
  if (input.isProcessing) {
    // Once the mic closes nothing is provisional any more — the whole stream
    // reads as one settled draft while the final pass decides what's pasted.
    const phase = input.processingPhase === "polishing" ? "polishing" : "correcting";
    return { phase, committed: text, partial: "" };
  }
  if (input.finalText) return { phase: "done", committed: input.finalText, partial: "" };
  return { phase: "hidden", committed: "", partial: "" };
}

export interface StreamingModelOption {
  id: string;
  name: string;
  sizeMb: number;
  languages: string[];
  coversChinese: boolean;
  isDefault: boolean;
}

interface RegistryEntry {
  name: string;
  sizeMb: number;
  supportedLanguages?: string[];
  runtime?: string;
}

/** Streaming models the live preview can use, the recommended default first. */
export function listStreamingModels(
  registry: Record<string, RegistryEntry>
): StreamingModelOption[] {
  return Object.entries(registry)
    .filter(([, entry]) => entry.runtime === "online")
    .map(([id, entry]) => {
      const languages = entry.supportedLanguages ?? [];
      return {
        id,
        name: entry.name,
        sizeMb: entry.sizeMb,
        languages,
        coversChinese: languages.includes("zh"),
        isDefault: id === DEFAULT_LIVE_PREVIEW_MODEL,
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

const LISTENING_FRAME: LivePanelView = Object.freeze({ phase: "listening", committed: "", partial: "" });

export interface LivePanelFrameInput {
  view: LivePanelView;
  /** The last frame the panel showed during the previous capture. */
  lastFrame: LivePanelView | null;
  /** This capture resolved to a live plan (the stream is running or ran). */
  isLiveCapture: boolean;
  /** Hotkey pressed, mic not open yet. */
  starting: boolean;
  liveMode: boolean;
  autoHide: boolean;
  windowHidden: boolean;
}

/**
 * Which live-panel frame the overlay draws, or null for the regular indicator.
 * In live mode the old idle icon must never flash: from the hotkey press the
 * panel shows Listening; with auto-hide on, the finished frame holds while the
 * window hides, and a hidden window pre-renders Listening for the next show.
 */
export function pickLivePanelFrame(input: LivePanelFrameInput): LivePanelView | null {
  if (input.isLiveCapture && input.view.phase !== "hidden") return input.view;
  if (!input.liveMode) return null;
  if (input.starting) return LISTENING_FRAME;
  if (!input.autoHide) return null;
  return input.windowHidden ? LISTENING_FRAME : (input.lastFrame ?? LISTENING_FRAME);
}
