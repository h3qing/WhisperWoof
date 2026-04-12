/**
 * LatencyTracker — pipeline-stage timing collector.
 *
 * Pure TypeScript class. No DOM, no electron, no I/O. Used by:
 *   - `src/hooks/useAudioRecording.js` at runtime (wall-clock + performance.now)
 *   - `scripts/bench-latency.js` in the bench harness (injected clock for
 *     deterministic test / replay runs)
 *   - `latency-tracker.test.ts` (fake clock for unit tests)
 *
 * Two time sources on purpose:
 *   - `capturedAt` is `Date.now()` once at construction — a wall-clock
 *     millisecond-since-epoch timestamp useful for sorting / display.
 *     We only take it once because that's all we need for ordering
 *     captures in the history view.
 *   - every `mark(stage)` call uses `now()` (defaults to
 *     `performance.now()`) for the actual duration math. That gives
 *     microsecond-resolution monotonic time that won't jump if the
 *     wall clock drifts mid-capture.
 */

import type { PipelineStage, PipelineTimings } from "./types";

/** Clock source — separated so tests can inject a deterministic clock. */
export interface Clock {
  now(): number;
  wallClockMs(): number;
}

/** Default runtime clock: performance.now() for durations + Date.now() for wall clock. */
export const defaultClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  wallClockMs: () => Date.now(),
};

export class LatencyTracker {
  private readonly marks = new Map<PipelineStage, number>();
  private readonly clock: Clock;
  public readonly capturedAt: number;

  constructor(clock: Clock = defaultClock) {
    this.clock = clock;
    this.capturedAt = clock.wallClockMs();
  }

  /**
   * Record that `stage` has just happened. Pass `when` to override the
   * clock (used when the timestamp was captured earlier in an async
   * chain — e.g. `recordingStartTime` inside the audio manager).
   */
  mark(stage: PipelineStage, when?: number): void {
    this.marks.set(stage, when ?? this.clock.now());
  }

  /**
   * Raw time for a stage. Undefined if the stage was never marked.
   * Exposed so tests / bench can assert on individual stage times.
   */
  get(stage: PipelineStage): number | undefined {
    return this.marks.get(stage);
  }

  /** True if the given stage has been marked. */
  has(stage: PipelineStage): boolean {
    return this.marks.has(stage);
  }

  /**
   * Milliseconds between two stages. Returns null if either stage is
   * missing. Result is rounded to the nearest ms (performance.now is
   * sub-millisecond but our storage is whole ms, and no downstream
   * cares about fractional milliseconds).
   *
   * Negative durations are coerced to 0 — they can happen when the
   * wall-clock / performance-clock lose strict ordering across async
   * boundaries (e.g. the mic started slightly before we managed to
   * mark `hotkey`). We never want a negative duration in
   * `metadata.timings`.
   */
  duration(from: PipelineStage, to: PipelineStage): number | null {
    const a = this.marks.get(from);
    const b = this.marks.get(to);
    if (a === undefined || b === undefined) return null;
    return Math.max(0, Math.round(b - a));
  }

  /**
   * Build the persistable `PipelineTimings` record. Any stage missing
   * a `mark()` call leaves the corresponding duration as null so the
   * dashboard can render "polish skipped" etc cleanly.
   */
  toTimings(): PipelineTimings {
    return {
      capturedAt: this.capturedAt,
      speakingMs: this.duration("micOpen", "micStop"),
      sttMs: this.duration("sttStart", "sttEnd"),
      polishMs: this.duration("polishStart", "polishEnd"),
      pasteMs: this.duration("pasteStart", "pasteEnd"),
      perceivedMs: this.duration("micStop", "pasteEnd"),
      totalMs: this.duration("hotkey", "pasteEnd"),
    };
  }
}

/**
 * Build a tracker with an injected fake clock for testing. Each call
 * to `now()` returns the next value from `sequence`; `wallClockMs`
 * returns a single fixed constant.
 */
export function fakeClock(sequence: number[], wallClockMs = 1_700_000_000_000): Clock {
  let i = 0;
  return {
    now: () => {
      if (i >= sequence.length) {
        throw new Error(`fakeClock exhausted after ${sequence.length} calls`);
      }
      return sequence[i++]!;
    },
    wallClockMs: () => wallClockMs,
  };
}
