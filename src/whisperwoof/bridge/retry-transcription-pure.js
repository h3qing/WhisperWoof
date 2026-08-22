/**
 * Pure decision logic for re-running transcription on stored audio.
 *
 * Lives apart from the IPC handler so it can be tested without an Electron
 * main process. The handler in ipcHandlers.js owns the side effects (reading
 * the audio blob, invoking an engine, writing the row back); everything that
 * decides *what to run* is here.
 */

const whisperModels = require("../../models/modelRegistryData.json").whisperModels || {};

// Parakeet TDT covers English + 24 European languages — no CJK. Retrying a
// Chinese recording on it returns empty and surfaces a misleading
// "No audio detected", so the same guard audioManager applies to live
// dictation has to apply to retries.
const PARAKEET_UNSUPPORTED = new Set(["zh", "ja", "ko", "yue", "th", "vi", "ar", "he", "hi"]);

/**
 * Resolve a whisper model id (`"turbo"`, `"small"`) to the `.bin` file to load,
 * given the files actually present on disk.
 *
 * Prefers the registry filename for the requested id, then any downloaded file
 * whose name contains the id, then any downloaded model at all — a retry with
 * a slightly different model beats refusing to retry.
 *
 * @returns {string|null} the filename to load, or null when nothing is downloaded
 */
function resolveRetryModelFile(downloadedFiles, requestedModelId) {
  const bins = (Array.isArray(downloadedFiles) ? downloadedFiles : []).filter(
    (f) => typeof f === "string" && f.endsWith(".bin")
  );
  if (bins.length === 0) return null;

  if (requestedModelId) {
    const registryFile = whisperModels[requestedModelId]?.fileName;
    if (registryFile && bins.includes(registryFile)) return registryFile;

    const contains = bins.find((f) => f.includes(requestedModelId));
    if (contains) return contains;
  }

  return bins[0];
}

/**
 * Decide which local engine a retry should use.
 *
 * `provider` is the user's configured local engine; `language` is their
 * dictation language (`"auto"`, `"zh-CN"`, `"en"`, …). Returns `"whisper"`
 * whenever Parakeet cannot serve the language, mirroring
 * audioManager.processAudio.
 *
 * @returns {"whisper"|"parakeet"}
 */
function resolveRetryProvider({ provider, language, parakeetAvailable, whisperAvailable }) {
  const wantsParakeet =
    (provider === "nvidia" || provider === "parakeet") && Boolean(parakeetAvailable);
  if (!wantsParakeet) return whisperAvailable ? "whisper" : "parakeet";

  const base = String(language || "").toLowerCase().split("-")[0];
  if (base && PARAKEET_UNSUPPORTED.has(base) && whisperAvailable) return "whisper";

  return "parakeet";
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
  resolveRetryModelFile,
  resolveRetryProvider,
  resolveRetryLanguage,
  PARAKEET_UNSUPPORTED,
};
