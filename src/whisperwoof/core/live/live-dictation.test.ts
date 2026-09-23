import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIVE_PREVIEW_MODEL,
  resolveLiveDictationPlan,
  deriveLivePanelView,
  toLiveSegments,
  listStreamingModels,
} from "./live-dictation";

const ONLINE = new Set([
  "x-asr-zh-en-streaming-480ms",
  "nemotron-3.5-asr-streaming-0.6b",
  "nemotron-speech-streaming-en-0.6b",
]);
const LANGS: Record<string, string[]> = {
  "x-asr-zh-en-streaming-480ms": ["zh", "en"],
  "nemotron-3.5-asr-streaming-0.6b": ["en", "ja"],
  "nemotron-speech-streaming-en-0.6b": ["en"],
};
const deps = {
  isOnlineModel: (id: string) => ONLINE.has(id),
  supportsLanguage: (lang: string | undefined, id: string) =>
    !lang || !LANGS[id] || LANGS[id].includes(lang),
};

const base = {
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "sense-voice-zh-en",
  preferredLanguage: "auto",
  dictationMode: "batch",
  livePreviewModel: DEFAULT_LIVE_PREVIEW_MODEL,
  liveFinalPass: "transcription",
};

describe("resolveLiveDictationPlan", () => {
  it("does nothing for cloud transcription", () => {
    const plan = resolveLiveDictationPlan({ ...base, useLocalWhisper: false, dictationMode: "live" }, deps);
    expect(plan).toEqual({ live: false, stream: false, previewModel: null, useStreamedAsFinal: false });
  });

  it("batch mode with an offline model neither streams nor goes live", () => {
    const plan = resolveLiveDictationPlan(base, deps);
    expect(plan.live).toBe(false);
    expect(plan.stream).toBe(false);
  });

  it("batch mode keeps the legacy Nemotron behaviour: stream and use it as final", () => {
    const plan = resolveLiveDictationPlan(
      { ...base, parakeetModel: "nemotron-speech-streaming-en-0.6b" },
      deps
    );
    expect(plan).toEqual({
      live: false,
      stream: true,
      previewModel: "nemotron-speech-streaming-en-0.6b",
      useStreamedAsFinal: true,
    });
  });

  it("live mode streams the preview model and re-decodes with the transcription model", () => {
    const plan = resolveLiveDictationPlan({ ...base, dictationMode: "live" }, deps);
    expect(plan).toEqual({
      live: true,
      stream: true,
      previewModel: "x-asr-zh-en-streaming-480ms",
      useStreamedAsFinal: false,
    });
  });

  it("live mode can take the streamed text as final", () => {
    const plan = resolveLiveDictationPlan(
      { ...base, dictationMode: "live", liveFinalPass: "preview" },
      deps
    );
    expect(plan.useStreamedAsFinal).toBe(true);
  });

  it("live mode works with Whisper as the transcription engine", () => {
    const plan = resolveLiveDictationPlan(
      { ...base, dictationMode: "live", localTranscriptionProvider: "whisper" },
      deps
    );
    expect(plan.stream).toBe(true);
    expect(plan.useStreamedAsFinal).toBe(false);
  });

  it("falls back to the default preview model when the saved one is not a streaming model", () => {
    const plan = resolveLiveDictationPlan(
      { ...base, dictationMode: "live", livePreviewModel: "sense-voice-zh-en" },
      deps
    );
    expect(plan.previewModel).toBe(DEFAULT_LIVE_PREVIEW_MODEL);
  });

  it("drops live mode when the preview model can't serve the pinned language", () => {
    const plan = resolveLiveDictationPlan(
      {
        ...base,
        dictationMode: "live",
        livePreviewModel: "nemotron-speech-streaming-en-0.6b",
        preferredLanguage: "zh-CN",
      },
      deps
    );
    // Nothing could ever appear in the panel, so fall back to the regular indicator.
    expect(plan).toEqual({ live: false, stream: false, previewModel: null, useStreamedAsFinal: false });
  });

  it("previews with the transcription model when that model streams itself (one server, no model swaps)", () => {
    const plan = resolveLiveDictationPlan(
      { ...base, dictationMode: "live", parakeetModel: "nemotron-speech-streaming-en-0.6b" },
      deps
    );
    expect(plan).toEqual({
      live: true,
      stream: true,
      previewModel: "nemotron-speech-streaming-en-0.6b",
      useStreamedAsFinal: true,
    });
  });

  it("uses the streamed text when the preview model is also the transcription model", () => {
    const plan = resolveLiveDictationPlan(
      {
        ...base,
        dictationMode: "live",
        parakeetModel: "x-asr-zh-en-streaming-480ms",
      },
      deps
    );
    expect(plan.useStreamedAsFinal).toBe(true);
  });
});

describe("deriveLivePanelView", () => {
  const idle = {
    isRecording: false,
    isProcessing: false,
    processingPhase: "idle",
    segments: { text: "", committed: "", partial: "" },
    finalText: "",
  };

  it("is hidden when nothing is happening", () => {
    expect(deriveLivePanelView(idle).phase).toBe("hidden");
  });

  it("listens before any text arrives", () => {
    expect(deriveLivePanelView({ ...idle, isRecording: true }).phase).toBe("listening");
  });

  it("streams committed and provisional text while recording", () => {
    const view = deriveLivePanelView({
      ...idle,
      isRecording: true,
      segments: { text: "今天下午，三点开个", committed: "今天下午，", partial: "三点开个" },
    });
    expect(view).toEqual({ phase: "streaming", committed: "今天下午，", partial: "三点开个" });
  });

  it("keeps the English space between committed text and the provisional tail", () => {
    const view = deriveLivePanelView({
      ...idle,
      isRecording: true,
      segments: { text: "Ship it. Then iterate", committed: "Ship it.", partial: "Then iterate" },
    });
    expect(view).toEqual({ phase: "streaming", committed: "Ship it. ", partial: "Then iterate" });
  });

  it("shows the streamed text as settled while the final pass runs", () => {
    const view = deriveLivePanelView({
      ...idle,
      isProcessing: true,
      processingPhase: "transcribing",
      segments: { text: "今天下午，三点开个", committed: "今天下午，", partial: "三点开个" },
    });
    expect(view).toEqual({ phase: "correcting", committed: "今天下午，三点开个", partial: "" });
  });

  it("switches to polishing when the reasoning step starts", () => {
    const view = deriveLivePanelView({
      ...idle,
      isProcessing: true,
      processingPhase: "polishing",
      segments: { text: "hi", committed: "hi", partial: "" },
    });
    expect(view.phase).toBe("polishing");
  });

  it("shows the final text once it lands", () => {
    const view = deriveLivePanelView({ ...idle, finalText: "今天下午三点开会。" });
    expect(view).toEqual({ phase: "done", committed: "今天下午三点开会。", partial: "" });
  });
});

describe("toLiveSegments", () => {
  it("treats a bare string (cloud providers) as all provisional", () => {
    expect(toLiveSegments("hello wor")).toEqual({ text: "hello wor", committed: "", partial: "hello wor" });
  });

  it("passes the main-process split through", () => {
    expect(toLiveSegments({ text: "a b", committed: "a", partial: "b" })).toEqual({
      text: "a b",
      committed: "a",
      partial: "b",
    });
  });

  it("returns empty segments for junk", () => {
    expect(toLiveSegments(null)).toEqual({ text: "", committed: "", partial: "" });
  });
});

describe("listStreamingModels", () => {
  const info = {
    "parakeet-tdt-0.6b-v3": { name: "Parakeet", sizeMb: 680, supportedLanguages: ["en"] },
    "nemotron-speech-streaming-en-0.6b": {
      name: "Nemotron EN",
      sizeMb: 442,
      supportedLanguages: ["en"],
      runtime: "online",
    },
    "x-asr-zh-en-streaming-480ms": {
      name: "X-ASR",
      sizeMb: 134,
      supportedLanguages: ["zh", "en"],
      runtime: "online",
    },
  };

  it("keeps only streaming models, default first, and flags Chinese coverage", () => {
    expect(listStreamingModels(info)).toEqual([
      { id: "x-asr-zh-en-streaming-480ms", name: "X-ASR", sizeMb: 134, languages: ["zh", "en"], coversChinese: true, isDefault: true },
      { id: "nemotron-speech-streaming-en-0.6b", name: "Nemotron EN", sizeMb: 442, languages: ["en"], coversChinese: false, isDefault: false },
    ]);
  });
});
