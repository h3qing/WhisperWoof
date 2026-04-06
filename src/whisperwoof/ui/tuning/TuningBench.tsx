/**
 * TuningBench — Horizontal flow chart pipeline tuner
 *
 * Record audio → transcribe → select preset × LLM combos → compare outputs
 * Includes audio playback, ideal output for scoring, and flow chart node selection.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Beaker,
  Mic,
  Play,
  Trash2,
  Check,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
  Star,
  Copy,
  StopCircle,
  Volume2,
  Pause,
  Target,
} from "lucide-react";
import { cn } from "../../../components/lib/utils";

// --- Types ---

interface Variant {
  id: string;
  polishPreset: string;
  llmProvider: string;
  llmModel: string;
  output: string | null;
  polishedOutput: string | null;
  durationMs: number | null;
  error: string | null;
  status: "pending" | "running" | "done" | "error";
  score?: number; // WER against ideal output
}

interface TuningAPI {
  whisperwoofTuningRunVariant?: (config: Record<string, string>) => Promise<Variant>;
  transcribeLocalWhisper?: (blob: ArrayBuffer, opts: Record<string, unknown>) => Promise<{ text?: string; error?: string }>;
}

function getAPI(): TuningAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

// --- WER scoring ---

function wordErrorRate(expected: string, actual: string): number {
  const exp = expected.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const act = actual.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (exp.length === 0) return 0;

  const m = exp.length, n = act.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = exp[i - 1] === act[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return Math.round((dp[m][n] / m) * 100);
}

// --- Constants ---

const PRESETS = [
  { id: "clean", label: "Clean", desc: "Remove fillers, fix grammar" },
  { id: "professional", label: "Professional", desc: "Confident, formal tone" },
  { id: "casual", label: "Casual", desc: "Light cleanup, natural" },
  { id: "minimal", label: "Minimal", desc: "Only remove fillers" },
  { id: "structured", label: "Structured", desc: "Markdown with headings" },
];

const LLM_MODELS = [
  { id: "ollama:llama3.2:1b", label: "Llama 3.2 1B", provider: "ollama", speed: "fastest" },
  { id: "ollama:llama3.2:3b", label: "Llama 3.2 3B", provider: "ollama", speed: "fast" },
  { id: "ollama:llama3.1:8b", label: "Llama 3.1 8B", provider: "ollama", speed: "balanced" },
  { id: "ollama:mistral:7b", label: "Mistral 7B", provider: "ollama", speed: "balanced" },
  { id: "groq:llama-3.1-8b-instant", label: "Groq Llama 8B", provider: "groq", speed: "very fast" },
  { id: "openai:gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", speed: "fast" },
];

// --- Flow Node ---

function FlowNode({ label, sublabel, selected, onClick }: {
  label: string; sublabel?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-lg border transition-all duration-150",
        selected
          ? "border-[#A06A3C]/40 bg-[#A06A3C]/[0.08] text-foreground"
          : "border-border/15 dark:border-white/6 text-muted-foreground/60 hover:text-foreground hover:border-border/30"
      )}
    >
      <span className="text-xs font-medium block">{label}</span>
      {sublabel && <span className="text-[10px] text-muted-foreground/40 block mt-0.5">{sublabel}</span>}
    </button>
  );
}

// --- Output Card ---

function OutputCard({ variant, isFastest, isBest }: {
  variant: Variant; isFastest: boolean; isBest: boolean;
}) {
  const handleCopy = () => {
    const text = variant.polishedOutput || variant.output;
    if (text) navigator.clipboard.writeText(text);
  };

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2 transition-all",
      isBest
        ? "border-emerald-500/30 bg-emerald-500/[0.03] ring-1 ring-emerald-500/20"
        : variant.status === "error"
          ? "border-red-500/20 bg-red-500/[0.03]"
          : "border-border/15 dark:border-white/6 bg-foreground/[0.01] dark:bg-white/[0.015]"
    )}>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
        <span className="px-1.5 py-0.5 rounded bg-foreground/[0.04] dark:bg-white/[0.04] font-medium">{variant.polishPreset}</span>
        <ChevronRight size={8} />
        <span className="px-1.5 py-0.5 rounded bg-foreground/[0.04] dark:bg-white/[0.04]">{variant.llmModel.split(":").pop()}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {variant.score != null && (
            <span className={cn("font-medium", variant.score < 20 ? "text-emerald-500/70" : variant.score < 50 ? "text-amber-500/70" : "text-red-400/70")}>
              {100 - variant.score}% match
            </span>
          )}
          {variant.durationMs != null && (
            <span className="flex items-center gap-0.5"><Clock size={8} />{(variant.durationMs / 1000).toFixed(1)}s</span>
          )}
          {isFastest && <Star size={8} className="text-emerald-500/60" />}
          {isBest && <Target size={8} className="text-emerald-500/60" />}
        </span>
      </div>

      {variant.status === "running" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-2">
          <Loader2 size={12} className="animate-spin" /> Processing...
        </div>
      )}
      {variant.status === "error" && (
        <p className="text-xs text-red-400/70 flex items-start gap-1.5">
          <AlertCircle size={11} className="shrink-0 mt-0.5" />{variant.error}
        </p>
      )}
      {variant.status === "done" && (
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap flex-1">
            {variant.polishedOutput || variant.output || "(empty)"}
          </p>
          <button onClick={handleCopy} className="shrink-0 p-1 rounded hover:bg-foreground/5 text-muted-foreground/25 hover:text-foreground">
            <Copy size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// --- Main ---

export default function TuningBench() {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pipeline state
  const [rawTranscript, setRawTranscript] = useState("");
  const [idealOutput, setIdealOutput] = useState("");
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set(["clean", "professional"]));
  const [selectedLLMs, setSelectedLLMs] = useState<Set<string>>(new Set(["ollama:llama3.2:1b"]));
  const [variants, setVariants] = useState<Variant[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const toggleSet = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  // --- Recording ---

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = []; // free chunk memory
        audioBlobRef.current = blob; // keep blob for playback + re-transcription
        setHasAudio(true);
        setIsRecording(false);

        // Transcribe via whisper-server
        setIsTranscribing(true);
        try {
          const api = getAPI();
          if (api.transcribeLocalWhisper) {
            const arrayBuffer = await blob.arrayBuffer();
            const result = await api.transcribeLocalWhisper(arrayBuffer, {});
            if (result?.text) {
              setRawTranscript(result.text);
            } else {
              setRawTranscript(`[Transcription failed: ${result?.error || "unknown error"}]`);
            }
          } else {
            setRawTranscript("[Whisper not available — paste text below instead]");
          }
        } catch (err) {
          setRawTranscript(`[Error: ${err instanceof Error ? err.message : "transcription failed"}]`);
        }
        setIsTranscribing(false);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  };

  const togglePlayback = () => {
    if (!audioBlobRef.current) return;
    if (audioPlaying) {
      audioRef.current?.pause();
      setAudioPlaying(false);
    } else {
      // Use blob URL for playback (more compatible than data URL in Electron)
      const url = URL.createObjectURL(audioBlobRef.current);
      const audio = new Audio(url);
      audio.onended = () => { setAudioPlaying(false); audioRef.current = null; URL.revokeObjectURL(url); };
      audio.play();
      audioRef.current = audio;
      setAudioPlaying(true);
    }
  };

  // --- Run variants ---

  const pathCount = selectedPresets.size * selectedLLMs.size;

  const handleRun = async () => {
    const text = rawTranscript.trim();
    if (!text || text.startsWith("[") || pathCount === 0) return;
    setIsRunning(true);

    const combos: { preset: string; provider: string; model: string }[] = [];
    for (const preset of selectedPresets) {
      for (const llmId of selectedLLMs) {
        const [provider, ...modelParts] = llmId.split(":");
        combos.push({ preset, provider, model: modelParts.join(":") });
      }
    }

    const pending: Variant[] = combos.map((c, i) => ({
      id: `v-${Date.now()}-${i}`,
      polishPreset: c.preset,
      llmProvider: c.provider,
      llmModel: c.model,
      output: null,
      polishedOutput: null,
      durationMs: null,
      error: null,
      status: "running" as const,
    }));
    setVariants(pending);

    const api = getAPI();
    if (api.whisperwoofTuningRunVariant) {
      const results = await Promise.all(
        combos.map((c) =>
          api.whisperwoofTuningRunVariant!({
            testCaseId: "live",
            inputText: text,
            polishPreset: c.preset,
            llmProvider: c.provider,
            llmModel: c.model,
          }).catch((err) => ({
            id: `err-${Date.now()}`,
            polishPreset: c.preset,
            llmProvider: c.provider,
            llmModel: c.model,
            output: null,
            polishedOutput: null,
            durationMs: null,
            error: err instanceof Error ? err.message : "failed",
            status: "error" as const,
          }))
        )
      );

      // Score against ideal output if provided
      const scored = results.map((r) => {
        const out = (r as any).output || (r as any).polishedOutput || "";
        const score = idealOutput.trim() ? wordErrorRate(idealOutput, out) : undefined;
        return { ...r, polishedOutput: out, status: (r as any).status || "done", score };
      });

      setVariants(scored as Variant[]);
    }

    setIsRunning(false);
  };

  // Find best variant (lowest WER score)
  const doneVariants = variants.filter((v) => v.status === "done" && v.durationMs);
  const fastestId = doneVariants.length > 0 ? doneVariants.reduce((a, b) => (a.durationMs! < b.durationMs! ? a : b)).id : null;
  const bestId = variants.filter((v) => v.score != null).length > 0
    ? variants.filter((v) => v.score != null).reduce((a, b) => (a.score! < b.score! ? a : b)).id
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border/15 dark:border-white/6 shrink-0">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Beaker size={14} className="text-primary/70" />
          Voice Style
        </h2>
        <p className="text-[11px] text-muted-foreground/50 mt-0.5">
          Speak naturally, compare styles, pick your favorite
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Step 1: Record */}
        <div className="space-y-2">
          <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">
            Say something
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                isRecording
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-[#A06A3C]/10 text-[#A06A3C] border border-[#A06A3C]/20 hover:bg-[#A06A3C]/15"
              )}
            >
              {isRecording ? <><StopCircle size={12} className="animate-pulse" /> Stop</> : <><Mic size={12} /> Record</>}
            </button>

            {isTranscribing && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                <Loader2 size={11} className="animate-spin" /> Transcribing...
              </span>
            )}

            {hasAudio && !isRecording && !isTranscribing && (
              <button
                onClick={togglePlayback}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-foreground px-2 py-1 rounded border border-border/15 dark:border-white/6 transition-colors"
              >
                {audioPlaying ? <Pause size={11} /> : <Volume2 size={11} />}
                {audioPlaying ? "Pause" : "Play back"}
              </button>
            )}

            {isRecording && <span className="text-[10px] text-red-400/50 animate-pulse">● Recording...</span>}
          </div>
        </div>

        {/* Raw transcript */}
        <div>
          <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium mb-1">
            What you said
          </div>
          <textarea
            value={rawTranscript}
            onChange={(e) => setRawTranscript(e.target.value)}
            placeholder="Or paste text here to compare styles..."
            className="w-full text-xs bg-transparent border border-border/15 dark:border-white/6 rounded-lg px-3 py-2 outline-none focus:border-primary/30 min-h-[48px] resize-none placeholder:text-muted-foreground/25"
            rows={2}
          />
        </div>

        {/* Ideal output (optional, for scoring) */}
        <div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium mb-1">
            <Target size={9} /> Ideal output <span className="normal-case font-normal">(optional — for quality scoring)</span>
          </div>
          <textarea
            value={idealOutput}
            onChange={(e) => setIdealOutput(e.target.value)}
            placeholder="Type what the perfect output should look like. Variants will be scored against this."
            className="w-full text-xs bg-transparent border border-border/15 dark:border-white/6 rounded-lg px-3 py-2 outline-none focus:border-primary/30 min-h-[40px] resize-none placeholder:text-muted-foreground/25"
            rows={2}
          />
        </div>

        {/* Flow chart: Preset × LLM */}
        <div className="flex gap-3 items-start">
          {/* Column: Polish Preset */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium mb-2 px-1">
              2. Polish Preset
            </div>
            <div className="space-y-1.5">
              {PRESETS.map((p) => (
                <FlowNode
                  key={p.id}
                  label={p.label}
                  sublabel={p.desc}
                  selected={selectedPresets.has(p.id)}
                  onClick={() => setSelectedPresets(toggleSet(selectedPresets, p.id))}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center pt-8 shrink-0 text-muted-foreground/15">
            <ChevronRight size={16} />
          </div>

          {/* Column: LLM Model */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium mb-2 px-1">
              3. LLM Model
            </div>
            <div className="space-y-1.5">
              {LLM_MODELS.map((m) => (
                <FlowNode
                  key={m.id}
                  label={m.label}
                  sublabel={`${m.provider} · ${m.speed}`}
                  selected={selectedLLMs.has(m.id)}
                  onClick={() => setSelectedLLMs(toggleSet(selectedLLMs, m.id))}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Run */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={isRunning || !rawTranscript.trim() || rawTranscript.startsWith("[") || pathCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-[#A06A3C] text-white hover:bg-[#B8863C] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run {pathCount} variant{pathCount !== 1 ? "s" : ""}
          </button>
          <span className="text-[10px] text-muted-foreground/40">
            {selectedPresets.size} preset{selectedPresets.size !== 1 ? "s" : ""} × {selectedLLMs.size} model{selectedLLMs.size !== 1 ? "s" : ""}
          </span>
          {idealOutput.trim() && <span className="text-[10px] text-emerald-500/50">● Scoring enabled</span>}
        </div>

        {/* Results */}
        {variants.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium px-1">
              Results {bestId && <span className="text-emerald-500/60 normal-case ml-1">— best match highlighted</span>}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {variants.map((v) => (
                <OutputCard key={v.id} variant={v} isFastest={v.id === fastestId} isBest={v.id === bestId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
