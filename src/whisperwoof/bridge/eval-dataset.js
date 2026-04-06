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

const EVAL_FILE = path.join(app.getPath("userData"), "eval-dataset.json");
const EVAL_AUDIO_DIR = path.join(app.getPath("userData"), "eval-audio");

function ensureDir() {
  if (!fs.existsSync(EVAL_AUDIO_DIR)) {
    fs.mkdirSync(EVAL_AUDIO_DIR, { recursive: true });
  }
}

function loadDataset() {
  try {
    if (fs.existsSync(EVAL_FILE)) {
      return JSON.parse(fs.readFileSync(EVAL_FILE, "utf-8"));
    }
  } catch (err) {
    debugLogger.warn("[EvalDataset] Failed to load", { error: err.message });
  }
  return { entries: [] };
}

function saveDataset(data) {
  try {
    fs.writeFileSync(EVAL_FILE, JSON.stringify(data, null, 2), "utf-8");
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
 * @param {string} [params.audioSourcePath] - original audio file path (will be copied)
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
      fs.writeFileSync(savedAudioPath, Buffer.from(audioBuffer));
    } catch (err) {
      debugLogger.warn("[EvalDataset] Failed to save audio", { error: err.message });
      savedAudioPath = null;
    }
  } else if (audioSourcePath && fs.existsSync(audioSourcePath)) {
    savedAudioPath = path.join(EVAL_AUDIO_DIR, `${id}.webm`);
    try {
      fs.copyFileSync(audioSourcePath, savedAudioPath);
    } catch (err) {
      debugLogger.warn("[EvalDataset] Failed to copy audio", { error: err.message });
      savedAudioPath = null;
    }
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
  const withAudio = dataset.entries.filter((e) => e.audioPath && fs.existsSync(e.audioPath)).length;

  return { total, good, bad, withAudio };
}

/**
 * Delete an eval entry and its audio file.
 */
function deleteEvalEntry(id) {
  const dataset = loadDataset();
  const entry = dataset.entries.find((e) => e.id === id);
  if (entry?.audioPath && fs.existsSync(entry.audioPath)) {
    try { fs.unlinkSync(entry.audioPath); } catch { /* */ }
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
