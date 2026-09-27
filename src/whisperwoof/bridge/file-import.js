/**
 * File Import Pipeline — Upload local audio files for transcription
 *
 * Accepts audio files (.mp3, .m4a, .wav, .webm, .ogg), transcodes via ffmpeg
 * if needed, runs through STT, and saves to bf_entries with source='import'.
 *
 * Runs in the background — user can keep using the app while transcription happens.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");

const { resolveUserAudioFile } = require("./user-audio-file");
const SUPPORTED_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".aac"]);
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

// Track active imports for progress reporting
const activeImports = new Map();

/**
 * Validate an audio file before importing.
 */
function validateAudioFile(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return { valid: false, error: "No file path provided" };
  }

  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Unsupported format: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
    };
  }

  if (!fs.existsSync(resolved)) {
    return { valid: false, error: "File not found" };
  }

  // Check (and later read) the real file: `voice.mp3` may be a symlink to anything.
  const real = resolveUserAudioFile(resolved);
  if (!real) {
    return { valid: false, error: "Not an audio file" };
  }

  const stats = fs.statSync(real);
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum is 500MB.`,
    };
  }

  return { valid: true, filePath: real, size: stats.size, extension: ext };
}

/**
 * Import an audio file — validate, read, and return buffer for transcription.
 * The actual STT call happens in the IPC handler (reuses existing whisper infrastructure).
 */
function importAudioFile(filePath) {
  const validation = validateAudioFile(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const importId = crypto.randomUUID();
  const filename = path.basename(filePath);

  activeImports.set(importId, {
    id: importId,
    filePath: validation.filePath,
    filename,
    size: validation.size,
    status: "reading",
    startedAt: Date.now(),
  });

  try {
    const audioBuffer = fs.readFileSync(validation.filePath);

    activeImports.set(importId, {
      ...activeImports.get(importId),
      status: "ready",
      bufferSize: audioBuffer.length,
    });

    debugLogger.info("[WhisperWoof] Audio file imported", {
      importId,
      filename,
      size: validation.size,
      extension: validation.extension,
    });

    return {
      success: true,
      importId,
      filename,
      audioBuffer,
      size: validation.size,
      extension: validation.extension,
    };
  } catch (err) {
    activeImports.set(importId, {
      ...activeImports.get(importId),
      status: "failed",
      error: err.message,
    });

    return { success: false, error: `Failed to read file: ${err.message}` };
  }
}

/**
 * Get the status of an active import.
 */
function getImportStatus(importId) {
  return activeImports.get(importId) || null;
}

/**
 * Clean up a completed import.
 */
function clearImport(importId) {
  activeImports.delete(importId);
}

/**
 * Get supported file extensions for the file picker dialog.
 */
function getSupportedExtensions() {
  return [...SUPPORTED_EXTENSIONS].map((ext) => ext.slice(1)); // Remove leading dot
}

module.exports = {
  validateAudioFile,
  importAudioFile,
  getImportStatus,
  clearImport,
  getSupportedExtensions,
  SUPPORTED_EXTENSIONS,
};
