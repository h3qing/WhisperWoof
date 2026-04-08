const debugLogger = require("./debugLogger");
const DefaultOpenAIRealtimeStreaming = require("./openaiRealtimeStreaming");

const SESSION_MAX_AGE_MS = 25 * 60 * 1000; // rotate at 25min (5min before OpenAI's ~30min limit)
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff
const ROTATION_CHECK_INTERVAL_MS = 30_000; // check every 30s

/**
 * MeetingSessionManager wraps OpenAI Realtime streaming with:
 * - Automatic session rotation before OpenAI's timeout (~30min)
 * - Reconnection with exponential backoff on unexpected disconnects
 * - Seamless audio re-routing during rotation
 *
 * Each "slot" (mic, system) is independently managed.
 */
class MeetingSessionManager {
  /**
   * @param {Object} options
   * @param {Function} options.fetchToken - async (source) => string — fetches a new API token
   * @param {Function} options.onSegment - (data) => void — called for transcript segments
   * @param {Function} options.onError - (error, source) => void — called on errors
   * @param {Function} options.onReconnecting - (source) => void — called when reconnecting
   * @param {Function} options.onReconnected - (source) => void — called after successful reconnect
   * @param {Object} [options.connectOpts] - Options passed to streaming.connect()
   * @param {Function} [options.StreamingClass] - Constructor for streaming instances (for testing)
   */
  constructor(options = {}) {
    this._fetchToken = options.fetchToken;
    this._onSegment = options.onSegment;
    this._onError = options.onError;
    this._onReconnecting = options.onReconnecting;
    this._onReconnected = options.onReconnected;
    this._connectOpts = options.connectOpts || {};
    this._StreamingClass = options.StreamingClass || DefaultOpenAIRealtimeStreaming;

    // { source: { streaming, connectedAt, reconnectAttempts } }
    this._slots = {};
    this._rotationTimer = null;
    this._started = false;
    this._stopping = false;
  }

  /**
   * Connect a streaming slot for the given source.
   * @param {string} source - "mic" or "system"
   * @param {string} token - API token for this connection
   */
  async connect(source, token) {
    if (this._slots[source]?.streaming?.isConnected) {
      await this._slots[source].streaming.disconnect().catch(() => {});
    }

    const streaming = new this._StreamingClass();
    this._attachHandlers(streaming, source);

    await streaming.connect({
      apiKey: token,
      ...this._connectOpts,
    });

    this._slots[source] = {
      streaming,
      connectedAt: Date.now(),
      reconnectAttempts: 0,
    };

    debugLogger.log("[SessionMgr] Connected", { source });

    // Start rotation timer if not already running
    if (!this._rotationTimer) {
      this._startRotationCheck();
    }

    this._started = true;
  }

  /**
   * Send audio to a slot.
   */
  sendAudio(buffer, source) {
    const slot = this._slots[source];
    if (!slot?.streaming) return false;
    return slot.streaming.sendAudio(buffer);
  }

  /**
   * Disconnect all slots and stop rotation checks.
   * @returns {{ transcripts: Object }} Final transcripts per source
   */
  async disconnectAll() {
    this._stopping = true;

    if (this._rotationTimer) {
      clearInterval(this._rotationTimer);
      this._rotationTimer = null;
    }

    const transcripts = {};

    for (const [source, slot] of Object.entries(this._slots)) {
      if (slot.streaming) {
        try {
          const result = await slot.streaming.disconnect();
          transcripts[source] = result?.text || "";
        } catch (err) {
          debugLogger.error("[SessionMgr] Disconnect error", {
            source,
            error: err.message,
          });
          transcripts[source] = slot.streaming.getFullTranscript?.() || "";
        }
      }
    }

    this._slots = {};
    this._started = false;
    this._stopping = false;

    debugLogger.log("[SessionMgr] All disconnected", {
      sources: Object.keys(transcripts),
    });

    return { transcripts };
  }

  /**
   * Get a streaming instance for direct access (e.g., for IPC handlers).
   */
  getStreaming(source) {
    return this._slots[source]?.streaming || null;
  }

  /**
   * Check if a source is connected.
   */
  isConnected(source) {
    return !!this._slots[source]?.streaming?.isConnected;
  }

  /**
   * Check if any source is connected.
   */
  isAnyConnected() {
    return Object.values(this._slots).some((s) => s?.streaming?.isConnected);
  }

  get isActive() {
    return this._started;
  }

  // --- Private ---

  _attachHandlers(streaming, source) {
    streaming.onPartialTranscript = (text) => {
      this._onSegment?.({
        text,
        source,
        type: "partial",
      });
    };

    streaming.onFinalTranscript = (text, timestamp) => {
      this._onSegment?.({
        text,
        source,
        type: "final",
        timestamp,
      });
    };

    streaming.onError = (err) => {
      if (this._stopping) return;

      debugLogger.error("[SessionMgr] Stream error", {
        source,
        error: err.message,
      });

      this._onError?.(err, source);
    };

    streaming.onSessionEnd = (data) => {
      if (this._stopping) return;

      debugLogger.log("[SessionMgr] Session ended unexpectedly", { source });
      this._handleUnexpectedDisconnect(source);
    };
  }

  async _handleUnexpectedDisconnect(source) {
    if (this._stopping) return;

    const slot = this._slots[source];
    if (!slot) return;

    const attempt = slot.reconnectAttempts;
    if (attempt >= RECONNECT_DELAYS.length) {
      debugLogger.error("[SessionMgr] Max reconnect attempts reached", {
        source,
        attempts: attempt,
      });
      this._onError?.(new Error(`Max reconnect attempts reached for ${source}`), source);
      return;
    }

    const delay = RECONNECT_DELAYS[attempt];
    debugLogger.log("[SessionMgr] Reconnecting", { source, attempt, delayMs: delay });
    this._onReconnecting?.(source);

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this._stopping) return;

    try {
      const token = await this._fetchToken(source);
      const streaming = new this._StreamingClass();
      this._attachHandlers(streaming, source);

      await streaming.connect({
        apiKey: token,
        ...this._connectOpts,
      });

      this._slots[source] = {
        streaming,
        connectedAt: Date.now(),
        reconnectAttempts: attempt + 1,
      };

      debugLogger.log("[SessionMgr] Reconnected", { source, attempt });
      this._onReconnected?.(source);
    } catch (err) {
      debugLogger.error("[SessionMgr] Reconnect failed", {
        source,
        attempt,
        error: err.message,
      });

      // Update attempts and retry
      if (this._slots[source]) {
        this._slots[source] = {
          ...this._slots[source],
          reconnectAttempts: attempt + 1,
        };
      }
      this._handleUnexpectedDisconnect(source);
    }
  }

  _startRotationCheck() {
    this._rotationTimer = setInterval(() => {
      this._checkRotation();
    }, ROTATION_CHECK_INTERVAL_MS);
  }

  async _checkRotation() {
    if (this._stopping) return;

    const now = Date.now();

    for (const [source, slot] of Object.entries(this._slots)) {
      if (!slot?.streaming?.isConnected) continue;

      const age = now - slot.connectedAt;
      if (age < SESSION_MAX_AGE_MS) continue;

      debugLogger.log("[SessionMgr] Rotating session", {
        source,
        ageMs: age,
        maxMs: SESSION_MAX_AGE_MS,
      });

      await this._rotateSession(source);
    }
  }

  async _rotateSession(source) {
    if (this._stopping) return;

    const oldSlot = this._slots[source];
    if (!oldSlot) return;

    try {
      // 1. Fetch new token
      const token = await this._fetchToken(source);

      // 2. Create new streaming instance
      const newStreaming = new this._StreamingClass();
      this._attachHandlers(newStreaming, source);

      // 3. Connect new instance
      await newStreaming.connect({
        apiKey: token,
        ...this._connectOpts,
      });

      // 4. Swap: update the slot to use new streaming
      this._slots[source] = {
        streaming: newStreaming,
        connectedAt: Date.now(),
        reconnectAttempts: 0,
      };

      // 5. Gracefully disconnect old instance (will produce final transcript)
      await oldSlot.streaming.disconnect().catch(() => {});

      debugLogger.log("[SessionMgr] Session rotated", { source });
    } catch (err) {
      debugLogger.error("[SessionMgr] Rotation failed, keeping old session", {
        source,
        error: err.message,
      });
      // Keep old session running — it may still have some time left
    }
  }
}

module.exports = MeetingSessionManager;
