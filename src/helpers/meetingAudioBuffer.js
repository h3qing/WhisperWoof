const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const debugLogger = require("./debugLogger");

const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const SEGMENT_DURATION_MS = 5 * 60 * 1000; // 5 minutes per file
const WAV_HEADER_SIZE = 44;

/**
 * Build a WAV header buffer for the given data size.
 */
function buildWavHeader(dataSize) {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = NUM_CHANNELS * BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

/**
 * Write WAV header at position 0 without advancing the file offset.
 * Used to patch the header after all data has been written.
 */
function patchWavHeader(fd, dataSize) {
  const header = buildWavHeader(dataSize);
  fs.writeSync(fd, header, 0, WAV_HEADER_SIZE, 0);
}

/**
 * Write WAV header at the current file position (advancing the offset).
 * Used when initially creating the file so subsequent writes go after the header.
 */
function writeInitialWavHeader(fd) {
  const header = buildWavHeader(0);
  fs.writeSync(fd, header);
}

/**
 * MeetingAudioBuffer manages crash-safe local audio persistence during meetings.
 *
 * Audio chunks are written to rotating WAV files (5-minute segments).
 * Each segment is a valid, self-contained WAV file. If the app crashes,
 * completed segments are recoverable from disk.
 *
 * Supports two independent sources: "mic" and "system".
 */
class MeetingAudioBuffer {
  constructor(baseDir) {
    this._baseDir = baseDir || require("electron").app.getPath("temp");
    this._sessionId = null;
    this._sessionDir = null;
    this._sources = {}; // { mic: SourceState, system: SourceState }
    this._started = false;
  }

  /**
   * Start a new recording session. Creates a temp directory for audio segments.
   * @returns {string} Session ID
   */
  start() {
    if (this._started) {
      debugLogger.log("[AudioBuffer] Already started, ignoring");
      return this._sessionId;
    }

    this._sessionId = crypto.randomUUID();
    this._sessionDir = path.join(this._baseDir, `meeting-audio-${this._sessionId}`);
    fs.mkdirSync(this._sessionDir, { recursive: true });

    this._sources = {};
    this._started = true;

    debugLogger.log("[AudioBuffer] Session started", {
      sessionId: this._sessionId,
      dir: this._sessionDir,
    });

    return this._sessionId;
  }

  /**
   * Write a PCM audio chunk to disk for the given source.
   * Automatically rotates to a new segment file after SEGMENT_DURATION_MS.
   */
  writeChunk(pcmBuffer, source) {
    if (!this._started) return;

    const buf = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
    if (buf.length === 0) return;

    const sourceState = this._getOrCreateSource(source);
    const now = Date.now();

    // Rotate segment if time limit reached
    if (sourceState.fd !== null && now - sourceState.segmentStartedAt >= SEGMENT_DURATION_MS) {
      this._closeSegment(sourceState);
    }

    // Open new segment if needed
    if (sourceState.fd === null) {
      this._openSegment(sourceState, source);
    }

    fs.writeSync(sourceState.fd, buf, 0, buf.length);
    sourceState.dataSize += buf.length;
    sourceState.totalBytes += buf.length;
  }

  /**
   * Stop the session and finalize all open segment files.
   * @param {Object} options
   * @param {boolean} options.keepFiles - If true, don't delete files (for recovery).
   * @returns {{ sessionId: string, files: string[], totalBytes: Object }}
   */
  stop(options = {}) {
    if (!this._started) {
      return { sessionId: null, files: [], totalBytes: {} };
    }

    const files = [];
    const totalBytes = {};

    for (const [source, state] of Object.entries(this._sources)) {
      this._closeSegment(state);
      files.push(...state.completedFiles);
      totalBytes[source] = state.totalBytes;
    }

    const result = {
      sessionId: this._sessionId,
      dir: this._sessionDir,
      files: [...files],
      totalBytes: { ...totalBytes },
    };

    debugLogger.log("[AudioBuffer] Session stopped", {
      sessionId: this._sessionId,
      fileCount: files.length,
      totalBytes,
    });

    if (!options.keepFiles) {
      // Schedule cleanup — give time for any batch re-transcription
      this._pendingCleanupDir = this._sessionDir;
    }

    this._sources = {};
    this._started = false;
    this._sessionDir = null;
    this._sessionId = null;

    return result;
  }

  /**
   * Clean up temporary audio files from disk.
   * Call after batch re-transcription is complete or when files are no longer needed.
   */
  cleanupFiles(dir) {
    const targetDir = dir || this._pendingCleanupDir;
    if (!targetDir) return;

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        debugLogger.log("[AudioBuffer] Cleaned up", { dir: targetDir });
      }
    } catch (err) {
      debugLogger.error("[AudioBuffer] Cleanup failed", { dir: targetDir, error: err.message });
    }

    if (targetDir === this._pendingCleanupDir) {
      this._pendingCleanupDir = null;
    }
  }

  /**
   * Get all completed segment files for a given source (or all sources).
   */
  getBufferedFiles(source) {
    if (!this._started) return [];

    if (source) {
      const state = this._sources[source];
      return state ? [...state.completedFiles] : [];
    }

    return Object.values(this._sources).flatMap((s) => [...s.completedFiles]);
  }

  /**
   * Get session directory path (for external recovery tools).
   */
  getSessionDir() {
    return this._sessionDir;
  }

  get isActive() {
    return this._started;
  }

  // --- Private methods ---

  _getOrCreateSource(source) {
    if (!this._sources[source]) {
      this._sources[source] = {
        fd: null,
        filePath: null,
        segmentIndex: 0,
        segmentStartedAt: 0,
        dataSize: 0,
        totalBytes: 0,
        completedFiles: [],
      };
    }
    return this._sources[source];
  }

  _openSegment(state, source) {
    const fileName = `${source}-${String(state.segmentIndex).padStart(4, "0")}.wav`;
    const filePath = path.join(this._sessionDir, fileName);

    const fd = fs.openSync(filePath, "w");
    writeInitialWavHeader(fd); // placeholder header, advances file offset to 44

    state.fd = fd;
    state.filePath = filePath;
    state.segmentStartedAt = Date.now();
    state.dataSize = 0;

    debugLogger.debug("[AudioBuffer] Segment opened", { source, file: fileName });
  }

  _closeSegment(state) {
    if (state.fd === null) return;

    try {
      // Patch WAV header with actual data size (pwrite — doesn't move offset)
      patchWavHeader(state.fd, state.dataSize);
      fs.closeSync(state.fd);

      if (state.dataSize > 0) {
        state.completedFiles.push(state.filePath);
        debugLogger.debug("[AudioBuffer] Segment closed", {
          file: path.basename(state.filePath),
          dataSize: state.dataSize,
        });
      } else {
        // Remove empty files
        try {
          fs.unlinkSync(state.filePath);
        } catch {}
      }
    } catch (err) {
      debugLogger.error("[AudioBuffer] Failed to close segment", {
        file: state.filePath,
        error: err.message,
      });
    }

    state.fd = null;
    state.filePath = null;
    state.segmentIndex++;
    state.dataSize = 0;
  }
}

module.exports = MeetingAudioBuffer;
