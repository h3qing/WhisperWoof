/**
 * Pure decision logic for re-running transcription on stored audio.
 *
 * Lives apart from the IPC handler so it can be tested without an Electron
 * main process. The handler in ipcHandlers.js owns the side effects (reading
 * the audio blob, invoking an engine, writing the row back); everything that
 * decides *what to run* is here.
 */

const registry = require("../../models/modelRegistryData.json");
const whisperModels = registry.whisperModels || {};
const parakeetModels = registry.parakeetModels || {};

// Fallback for a sherpa model the registry doesn't know: assume the classic
// Parakeet TDT coverage — English + European languages, no CJK. Retrying a
// Chinese recording on such a model returns empty and surfaces a misleading
// "No audio detected", so the same guard audioManager applies to live
// dictation has to apply to retries.
const PARAKEET_UNSUPPORTED = new Set(["zh", "ja", "ko", "yue", "th", "vi", "ar", "he", "hi"]);

/**
 * Whether the configured sherpa-engine model can serve `base` (a bare language
 * code). Registry `supportedLanguages` decides when the model is known —
 * SenseVoice covers zh/ja/ko/yue where Parakeet TDT does not.
 */
function sherpaModelServesLanguage(parakeetModel, base) {
  const supported = parakeetModels[parakeetModel]?.supportedLanguages;
  if (Array.isArray(supported) && supported.length > 0) return supported.includes(base);
  return !PARAKEET_UNSUPPORTED.has(base);
}

// Best-first when the requested model is not on disk: a retry with a
// slightly different model beats refusing to retry.
const WHISPER_QUALITY_ORDER = [
  "turbo",
  "large",
  "medium",
  "distil-large-v3.5",
  "distil-large-v3",
  "small",
  "base",
  "tiny",
];

/**
 * Resolve the whisper model id to load for a retry, given the registry ids
 * actually downloaded (from whisperManager.listWhisperModels). Returns a
 * registry id — transcribeLocalWhisper validates ids, never paths.
 *
 * @returns {string|null} the id to load, or null when nothing is downloaded
 */
function resolveRetryWhisperModel(downloadedIds, requestedModelId) {
  const ids = (Array.isArray(downloadedIds) ? downloadedIds : []).filter(
    (id) => typeof id === "string" && whisperModels[id]
  );
  if (ids.length === 0) return null;
  if (requestedModelId && ids.includes(requestedModelId)) return requestedModelId;
  return WHISPER_QUALITY_ORDER.find((id) => ids.includes(id)) ?? ids[0];
}

/**
 * Decide which local engine a retry should use.
 *
 * `provider` is the user's configured local engine; `language` is their
 * dictation language (`"auto"`, `"zh-CN"`, `"en"`, …). Returns `"whisper"`
 * whenever Parakeet cannot serve the language, mirroring
 * audioManager.processAudio. Qwen3-ASR (`"qwen"`) is used when its model is
 * on disk (`qwenAvailable`) and serves the language (`qwenServesLanguage`).
 *
 * @returns {"whisper"|"parakeet"|"qwen"}
 */
function resolveRetryProvider({
  provider,
  language,
  parakeetModel = undefined,
  parakeetAvailable,
  whisperAvailable,
  qwenAvailable = false,
  qwenServesLanguage = (_base) => true,
}) {
  // "auto" (the default) pins no language, as in resolveRetryLanguage.
  const pinned = String(language || "").toLowerCase();
  const base = pinned === "auto" ? "" : pinned.split("-")[0];
  if (provider === "qwen" && qwenAvailable && (!base || qwenServesLanguage(base))) return "qwen";
  const parakeetCanServe =
    Boolean(parakeetAvailable) && (!base || sherpaModelServesLanguage(parakeetModel, base));

  if ((provider === "nvidia" || provider === "parakeet") && parakeetCanServe) return "parakeet";
  if (whisperAvailable) return "whisper";

  // Whisper is down. Fall back to Parakeet only when it can actually serve the
  // language — otherwise return "whisper" so the caller surfaces the real
  // problem (the binary is missing) instead of an empty transcript.
  return parakeetCanServe ? "parakeet" : "whisper";
}

/**
 * Normalize the dictation-language preference into what whisper.cpp expects.
 * `"auto"` and empty values become null so the caller sends `auto` and lets
 * whisper detect — the only setting that transcribes zh and en speech each in
 * its own language instead of translating one into the other.
 */
function resolveRetryLanguage(language) {
  if (!language || language === "auto") return null;
  return String(language).split("-")[0];
}

module.exports = {
  resolveRetryWhisperModel,
  resolveRetryProvider,
  resolveRetryLanguage,
  PARAKEET_UNSUPPORTED,
};
