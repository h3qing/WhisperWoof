/**
 * Fn press-and-hold / double-tap-latch state machine — pure.
 *
 * Push-to-talk with a hands-free latch, Wispr-Flow style:
 *
 *   hold Fn, speak, release          -> transcript pastes (classic push-to-talk)
 *   double-tap Fn                    -> recording latches on, hands free
 *   tap Fn while latched             -> stop + paste
 *   single stray tap                 -> cancelled quietly (nothing pastes)
 *
 * The latency-critical property: a press held longer than `tapMaxMs` is a
 * HOLD, and its release stops + processes immediately — the double-tap
 * window only ever delays taps shorter than that, so normal dictation gains
 * zero latency. And because recording starts `minHoldMs` after the FIRST
 * press, a double-tap latch loses none of the opening words.
 *
 * Pure on purpose (the repo's truthfulness pattern): no timers, no Date —
 * the caller owns the clock. Every input returns a list of actions; timers
 * are requested via an `armTimer` action and delivered back through
 * `fire(id, now)`. All timing paths are unit-testable.
 *
 * Actions emitted:
 *   showPanel                       show the dictation overlay
 *   startRecording                  begin capture
 *   stopAndProcess                  stop capture and run the pipeline
 *   cancelRecording                 discard capture, nothing pastes
 *   hidePanel                       hide the overlay
 *   armTimer {id, delayMs}          call fire(id, now) after delayMs
 */

const DEFAULTS = {
  // Recording starts this long after press — filters accidental brushes.
  minHoldMs: 75,
  // Release faster than this = a tap (double-tap candidate); slower = a hold.
  tapMaxMs: 250,
  // A second press within this window after a tap latches recording on.
  doubleTapMs: 300,
  // Presses inside this window after a stop are ignored (key-bounce guard).
  cooldownMs: 100,
};

const TIMER_HOLD_START = "holdStart";
const TIMER_TAP_DECISION = "tapDecision";

function createFnActivationMachine(options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  let state = "idle"; // idle | pressed | tapWait | latched
  let pressedAt = 0;
  let pressSeq = 0; // invalidates stale holdStart timers
  let tapSeq = 0; // invalidates stale tapDecision timers
  let recordingStarted = false;
  let lastStopAt = -Infinity;
  let consumeNextRelease = false;

  function reset(now) {
    state = "idle";
    recordingStarted = false;
    consumeNextRelease = false;
    lastStopAt = now;
  }

  return {
    /** For logging/tests. */
    getState() {
      return state;
    },

    isRecording() {
      return recordingStarted;
    },

    press(now) {
      if (state === "latched") {
        // Single press while latched stops the hands-free recording. Stop on
        // key-DOWN, not release — snappiest possible stop.
        consumeNextRelease = true;
        reset(now);
        return [{ type: "stopAndProcess" }];
      }

      if (state === "tapWait") {
        // Second tap inside the window: latch on. Recording has been running
        // since minHoldMs after the FIRST press, so nothing was lost; if the
        // first tap was too quick to start it, start now.
        tapSeq++;
        const needStart = !recordingStarted;
        state = "latched";
        recordingStarted = true;
        consumeNextRelease = true;
        return needStart ? [{ type: "startRecording" }] : [];
      }

      if (state === "pressed") return []; // key repeat / duplicate down

      if (now - lastStopAt < cfg.cooldownMs) return [];

      state = "pressed";
      pressedAt = now;
      pressSeq++;
      recordingStarted = false;
      return [
        { type: "showPanel" },
        { type: "armTimer", id: TIMER_HOLD_START, seq: pressSeq, delayMs: cfg.minHoldMs },
      ];
    },

    release(now) {
      if (consumeNextRelease) {
        consumeNextRelease = false;
        return [];
      }
      if (state !== "pressed") return [];

      const heldMs = now - pressedAt;

      if (heldMs >= cfg.tapMaxMs) {
        // A real hold: classic push-to-talk. Stop + process immediately —
        // this path must never wait on the double-tap window.
        const wasRecording = recordingStarted;
        reset(now);
        return wasRecording
          ? [{ type: "stopAndProcess" }]
          : [{ type: "hidePanel" }];
      }

      // A tap: hold the decision open for a possible second tap. Recording
      // (if it started) keeps running so a latch loses no audio.
      state = "tapWait";
      tapSeq++;
      return [
        { type: "armTimer", id: TIMER_TAP_DECISION, seq: tapSeq, delayMs: cfg.doubleTapMs },
      ];
    },

    fire(id, now, seq) {
      if (id === TIMER_HOLD_START) {
        // Start recording only if this press is still the active one.
        if (state !== "pressed" && state !== "tapWait") return [];
        if (seq !== pressSeq) return [];
        if (recordingStarted) return [];
        recordingStarted = true;
        return [{ type: "startRecording" }];
      }

      if (id === TIMER_TAP_DECISION) {
        if (state !== "tapWait" || seq !== tapSeq) return [];
        // No second tap came: a lone sub-250ms tap is an accident or a missed
        // double-tap — nothing meaningful was said. Discard, never paste.
        const wasRecording = recordingStarted;
        reset(now);
        return wasRecording
          ? [{ type: "cancelRecording" }, { type: "hidePanel" }]
          : [{ type: "hidePanel" }];
      }

      return [];
    },

    /**
     * External stop (Fn+letter combo release, hotkey change, panel button).
     * The owner already stopped/cancelled the recording; just resync.
     */
    forceReset(now) {
      reset(now);
    },
  };
}

module.exports = {
  createFnActivationMachine,
  TIMER_HOLD_START,
  TIMER_TAP_DECISION,
};
