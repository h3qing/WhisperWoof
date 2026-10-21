/**
 * When background work (Cardputer transcription and summaries) may run —
 * pure functions.
 *
 * Dictation comes first: background work waits until the last interactive
 * request (dictation's cleanup) is at least BACKGROUND_IDLE_MS old, never
 * starts while one runs, and waits while the app is busy (a meeting being
 * transcribed). Measured cost of getting this wrong: dictation cleanup gives
 * up after 3 s and pastes the raw transcript.
 */

const BACKGROUND_IDLE_MS = 10_000;

/** Milliseconds to wait before background work may start; 0 means now. */
function backgroundDelayMs({
  now,
  lastInteractiveAt = null,
  interactiveRunning = false,
  busy = false,
  idleMs = BACKGROUND_IDLE_MS,
} = {}) {
  if (interactiveRunning || busy) return idleMs;
  if (!Number.isFinite(lastInteractiveAt)) return 0;
  return Math.max(0, lastInteractiveAt + idleMs - now);
}

function backgroundAllowed(args) {
  return backgroundDelayMs(args) === 0;
}

module.exports = { BACKGROUND_IDLE_MS, backgroundDelayMs, backgroundAllowed };
