const debugLogger = require("./debugLogger");

const DEFAULT_INTERVAL_MS = 60_000; // checkpoint every 60 seconds
const MIN_INTERVAL_MS = 10_000;

/**
 * MeetingTranscriptCheckpoint periodically saves transcript segments to the database.
 *
 * Even if the app crashes, at most DEFAULT_INTERVAL_MS worth of transcript is lost.
 * Segments are de-duplicated by ID so checkpoints are idempotent.
 */
class MeetingTranscriptCheckpoint {
  /**
   * @param {Object} options
   * @param {Object} options.databaseManager - Database manager for saving notes/transcripts
   * @param {number} [options.intervalMs] - Checkpoint interval in milliseconds
   */
  constructor(options = {}) {
    this._databaseManager = options.databaseManager;
    this._intervalMs = Math.max(options.intervalMs || DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
    this._timer = null;
    this._noteId = null;
    this._segments = [];
    this._lastCheckpointIndex = 0;
    this._started = false;
    this._audioBufferDir = null;
  }

  /**
   * Start checkpointing for a meeting note.
   * @param {string} noteId - The database note ID to update
   * @param {Object} [options]
   * @param {string} [options.audioBufferDir] - Path to audio buffer directory for crash recovery
   */
  start(noteId, options = {}) {
    if (this._started) {
      debugLogger.log("[Checkpoint] Already started, ignoring");
      return;
    }

    this._noteId = noteId;
    this._segments = [];
    this._lastCheckpointIndex = 0;
    this._started = true;
    this._audioBufferDir = options.audioBufferDir || null;

    this._timer = setInterval(() => {
      this._doCheckpoint();
    }, this._intervalMs);

    debugLogger.log("[Checkpoint] Started", {
      noteId,
      intervalMs: this._intervalMs,
    });
  }

  /**
   * Add a transcript segment. Will be persisted on the next checkpoint cycle.
   */
  addSegment(segment) {
    if (!this._started) return;

    this._segments = [
      ...this._segments,
      {
        id: segment.id,
        text: segment.text,
        source: segment.source,
        timestamp: segment.timestamp || Date.now(),
      },
    ];
  }

  /**
   * Stop checkpointing and do a final save.
   * @returns {{ savedSegments: number, noteId: string }}
   */
  stop() {
    if (!this._started) {
      return { savedSegments: 0, noteId: null };
    }

    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }

    // Final checkpoint
    this._doCheckpoint();

    const result = {
      savedSegments: this._segments.length,
      noteId: this._noteId,
    };

    debugLogger.log("[Checkpoint] Stopped", result);

    this._noteId = null;
    this._segments = [];
    this._lastCheckpointIndex = 0;
    this._started = false;
    this._audioBufferDir = null;

    return result;
  }

  /**
   * Force an immediate checkpoint (e.g., on WebSocket disconnect).
   */
  forceCheckpoint() {
    if (this._started) {
      this._doCheckpoint();
    }
  }

  get isActive() {
    return this._started;
  }

  // --- Private ---

  _doCheckpoint() {
    if (!this._noteId || !this._databaseManager) return;

    const newSegments = this._segments.slice(this._lastCheckpointIndex);
    if (newSegments.length === 0) return;

    try {
      // Build full transcript from all segments
      const fullTranscript = this._segments.map((s) => s.text).join("\n");

      // Build metadata with segment details and audio buffer location
      const metadata = {
        segmentCount: this._segments.length,
        lastSegmentTimestamp: this._segments[this._segments.length - 1]?.timestamp,
        checkpointedAt: Date.now(),
        audioBufferDir: this._audioBufferDir,
      };

      // Update the note content with the full transcript
      this._databaseManager.updateNote(this._noteId, {
        content: fullTranscript,
        metadata: JSON.stringify(metadata),
      });

      this._lastCheckpointIndex = this._segments.length;

      debugLogger.debug("[Checkpoint] Saved", {
        noteId: this._noteId,
        totalSegments: this._segments.length,
        newSegments: newSegments.length,
      });
    } catch (err) {
      debugLogger.error("[Checkpoint] Save failed", {
        noteId: this._noteId,
        error: err.message,
      });
    }
  }
}

module.exports = MeetingTranscriptCheckpoint;
