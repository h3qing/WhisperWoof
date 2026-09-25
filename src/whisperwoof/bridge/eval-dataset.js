/**
 * Eval Dataset — Persistent quality ratings for transcriptions
 *
 * Stores rated voice samples (thumbs up/down) as a personal eval set.
 * Used by Voice Style to benchmark new pipeline configurations against
 * known-good and known-bad examples.
 *
 * Storage: ~/.config/WhisperWoof/eval-dataset.json
 * Audio: ~/.config/WhisperWoof/eval-audio/ (preserved .webm files)
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const vaultFiles = require("./vault/vault-files");
const { resolveAppFile } = require("./app-files");

const EVAL_FILE = path.join(app.getPath("userData"), "eval-dataset.json");
const EVAL_AUDIO_DIR = path.join(app.getPath("userData"), "eval-audio");
// The app's own recordings (AudioStorageManager) — the only audio a rating may copy.
const RECORDINGS_DIR = path.join(app.getPath("userData"), "audio");

function ensureDir() {
  if (!fs.existsSync(EVAL_AUDIO_DIR)) {
    fs.mkdirSync(EVAL_AUDIO_DIR, { recursive: true });
  }
}

function loadDataset() {
  try {
    if (vaultFiles.exists(EVAL_FILE)) {
      return vaultFiles.readJson(EVAL_FILE, null);
    }
  } catch (err) {
    debugLogger.warn("[EvalDataset] Failed to load", { error: err.message });
  }
  return { entries: [] };
}

/**
 * Copy one of the app's recordings into eval-audio. The source path comes
 * from the renderer, so anything outside the recordings folder is refused.
 */
function copyRecording(audioSourcePath, savedAudioPath) {
  const sourcePath = resolveAppFile(audioSourcePath, [RECORDINGS_DIR]);
  if (!sourcePath) {
    debugLogger.warn("[EvalDataset] Ignored audio outside the recordings folder");
    return null;
  }
  try {
    // Plain or sealed, the copy is written the way encryption currently requires.
    vaultFiles.writeFile(savedAudioPath, vaultFiles.readFile(sourcePath), { kind: "audio" });
    return savedAudioPath;
  } catch (err) {
    debugLogger.warn("[EvalDataset] Failed to copy audio", { error: err.message });
    return null;
  }
}

function saveDataset(data) {
  try {
    vaultFiles.writeJson(EVAL_FILE, data, { requireUnlocked: true });
  } catch (err) {
    debugLogger.warn("[EvalDataset] Failed to save", { error: err.message });
  }
}

/**
 * Rate a transcription and save it to the eval dataset.
 *
 * @param {object} params
 * @param {string} params.entryId - bf_entries ID
 * @param {number} params.rating - 1 (good) or -1 (bad)
 * @param {string} params.rawTranscript - what STT produced
 * @param {string} params.polishedTranscript - what polish produced
 * @param {string} [params.idealOutput] - user-edited correct version
 * @param {string} [params.sttModel] - which STT model was used
 * @param {string} [params.polishPreset] - which preset was used
 * @param {string} [params.audioSourcePath] - a recording in userData/audio (will be copied; other paths are ignored)
 * @param {Buffer} [params.audioBuffer] - raw audio data to save
 */
function rateTranscription({
  entryId,
  rating,
  rawTranscript,
  polishedTranscript,
  idealOutput,
  sttModel,
  polishPreset,
  audioSourcePath,
  audioBuffer,
}) {
  ensureDir();
  const dataset = loadDataset();
  const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Save audio file if provided
  let savedAudioPath = null;
  if (audioBuffer) {
    savedAudioPath = path.join(EVAL_AUDIO_DIR, `${id}.webm`);
    try {
      vaultFiles.writeFile(savedAudioPath, Buffer.from(audioBuffer), { kind: "audio" });
    } catch (err) {
      debugLogger.warn("[EvalDataset] Failed to save audio", { error: err.message });
      savedAudioPath = null;
    }
  } else if (audioSourcePath) {
    savedAudioPath = copyRecording(audioSourcePath, path.join(EVAL_AUDIO_DIR, `${id}.webm`));
  }

  const entry = {
    id,
    entryId: entryId || null,
    rating, // 1 = good, -1 = bad
    rawTranscript: rawTranscript || "",
    polishedTranscript: polishedTranscript || "",
    idealOutput: idealOutput || null,
    sttModel: sttModel || "unknown",
    polishPreset: polishPreset || "unknown",
    audioPath: savedAudioPath,
    createdAt: new Date().toISOString(),
  };

  dataset.entries = [...dataset.entries, entry];
  saveDataset(dataset);

  debugLogger.log(`[EvalDataset] Rated entry: ${id} (${rating > 0 ? "good" : "bad"})`);
  return entry;
}

/**
 * Get all eval entries, optionally filtered by rating.
 */
function getEvalEntries(filter = {}) {
  const dataset = loadDataset();
  let entries = dataset.entries;

  if (filter.rating != null) {
    entries = entries.filter((e) => e.rating === filter.rating);
  }

  return entries;
}

/**
 * Get eval stats.
 */
function getEvalStats() {
  const dataset = loadDataset();
  const total = dataset.entries.length;
  const good = dataset.entries.filter((e) => e.rating === 1).length;
  const bad = dataset.entries.filter((e) => e.rating === -1).length;
  const withAudio = dataset.entries.filter((e) => e.audioPath && vaultFiles.exists(e.audioPath)).length;

  return { total, good, bad, withAudio };
}

/**
 * Delete an eval entry and its audio file.
 */
function deleteEvalEntry(id) {
  const dataset = loadDataset();
  const entry = dataset.entries.find((e) => e.id === id);
  // Only clips inside eval-audio — the path is read back from a JSON file.
  const audioPath = entry?.audioPath ? resolveAppFile(entry.audioPath, [EVAL_AUDIO_DIR]) : null;
  if (audioPath) {
    try { vaultFiles.unlink(audioPath); } catch { /* */ }
  }
  dataset.entries = dataset.entries.filter((e) => e.id !== id);
  saveDataset(dataset);
}

/**
 * Update an eval entry's ideal output.
 */
function updateIdealOutput(id, idealOutput) {
  const dataset = loadDataset();
  const idx = dataset.entries.findIndex((e) => e.id === id);
  if (idx >= 0) {
    dataset.entries[idx] = { ...dataset.entries[idx], idealOutput };
    saveDataset(dataset);
    return dataset.entries[idx];
  }
  return null;
}

module.exports = {
  rateTranscription,
  getEvalEntries,
  getEvalStats,
  deleteEvalEntry,
  updateIdealOutput,
};
