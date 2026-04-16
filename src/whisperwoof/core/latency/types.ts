/**
 * Latency instrumentation types — shared between the runtime tracker,
 * the bench harness, and any future dashboard UI.
 *
 * The pipeline has six named stages. We measure the durations between
 * them, not the absolute times — `performance.now()` is high-resolution
 * but not comparable across processes or meaningful after persistence,
 * so we store deltas only. A single wall-clock `capturedAt` (ms since
 * epoch) is kept for sorting and display.
 */

/**
 * Every point on the pipeline timeline we want to measure. The order
 * here is the order they occur at runtime:
 *
 *   hotkey        user pressed Fn / toggle hotkey fired
 *   micAcquired   getUserMedia resolved — OS mic driver is streaming samples
 *   micOpen       audio pipeline connected, ready to receive speech
 *   micStop       recording stopped (Fn release / VAD end / manual stop)
 *   sttStart      audio blob handed to the STT backend
 *   sttEnd        raw transcript string returned
 *   polishStart   polished-text LLM call started (optional — skipped if polish disabled)
 *   polishEnd     polished-text LLM call returned
 *   pasteStart    route+paste operation started (paste-at-cursor, save-markdown, route-to-project, etc)
 *   pasteEnd      destination app or storage acknowledged the text
 */
export type PipelineStage =
  | "hotkey"
  | "micAcquired"
  | "micOpen"
  | "micStop"
  | "sttStart"
  | "sttEnd"
  | "polishStart"
  | "polishEnd"
  | "pasteStart"
  | "pasteEnd";

/**
 * The flat, persistable shape written to `bf_entries.metadata.timings`.
 * Any duration may be `null` when the corresponding stage never fired
 * (e.g. polish is disabled, or the capture short-circuited via snippet
 * expansion). Never negative.
 */
export interface PipelineTimings {
  /** Wall-clock (ms since epoch) when the capture started. Used for sorting / display only. */
  readonly capturedAt: number;
  /** `micOpen` → `micStop`. How long the user spoke. */
  readonly speakingMs: number | null;
  /** `sttStart` → `sttEnd`. Raw STT roundtrip. */
  readonly sttMs: number | null;
  /** `polishStart` → `polishEnd`. LLM polish roundtrip. `null` when polish is disabled. */
  readonly polishMs: number | null;
  /** `pasteStart` → `pasteEnd`. Route + paste / save dispatch. */
  readonly pasteMs: number | null;
  /**
   * `micStop` → `pasteEnd`. The user-perceived latency — time from
   * when they stopped talking to when the text appeared. This is the
   * number we gate on (<500ms budget).
   */
  readonly perceivedMs: number | null;
  /** `hotkey` → `pasteEnd`. End-to-end including the user's speaking time. */
  readonly totalMs: number | null;
  /**
   * `hotkey` → `micOpen`. Total startup latency — the gap the user feels
   * between pressing the button and hearing the start cue / seeing the
   * recording indicator. This is the metric we're optimizing.
   */
  readonly startupMs: number | null;
  /**
   * `hotkey` → `micAcquired`. Time spent in getUserMedia (OS mic driver
   * init). Dominant on cold start (~500ms macOS), fast on warm (~10-30ms).
   */
  readonly micAcquireMs: number | null;
}

/**
 * Latency budget for the user-perceived portion of the pipeline
 * (micStop → pasteEnd). Anything over this is a user-visible lag.
 */
export const PERCEIVED_LATENCY_BUDGET_MS = 500;
