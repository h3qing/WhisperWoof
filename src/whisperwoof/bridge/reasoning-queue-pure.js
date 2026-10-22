/**
 * The local model's queue — pure functions over an immutable state.
 *
 * llama-server answers one non-streaming request at a time, and dictation's
 * cleanup gives up after 3 s. So:
 * - interactive work (dictation cleanup) runs before background work
 *   (Cardputer summaries);
 * - an interactive job arriving while a background call runs preempts it:
 *   the caller aborts that call, and the job goes back to the head of the
 *   background line, to run again later;
 * - background work starts only when the gate allows (background-gate-pure.js).
 *
 * State: { waiting: Job[] (interactive first, then background), running: Job|null }.
 * Job: { id, kind: "interactive" | "background" } (payloads live with the caller).
 */

const KINDS = Object.freeze({ INTERACTIVE: "interactive", BACKGROUND: "background" });

// A background answer never needs more: a map piece is a few bullets, the
// reduce a page of notes. A short answer also frees the server sooner.
const BACKGROUND_TOKEN_CAPS = Object.freeze({ map: 512, reduce: 1024 });

function freezeState(waiting, running) {
  return Object.freeze({ waiting: Object.freeze([...waiting]), running });
}

function createQueue() {
  return freezeState([], null);
}

function assertJob(job) {
  if (!job || typeof job.id !== "string" || !job.id) throw new Error("A job needs an id");
  if (job.kind !== KINDS.INTERACTIVE && job.kind !== KINDS.BACKGROUND) {
    throw new Error(`Unknown job kind: ${job?.kind}`);
  }
}

function splitWaiting(waiting) {
  return {
    interactive: waiting.filter((j) => j.kind === KINDS.INTERACTIVE),
    background: waiting.filter((j) => j.kind === KINDS.BACKGROUND),
  };
}

/**
 * Add a job. → { state, preempt }: `preempt` is the background job the
 * caller must abort now (already back at the head of the background line).
 */
function enqueue(state, job) {
  assertJob(job);
  const frozenJob = Object.freeze({ ...job });
  const { interactive, background } = splitWaiting(state.waiting);
  if (frozenJob.kind === KINDS.BACKGROUND) {
    return { state: freezeState([...state.waiting, frozenJob], state.running), preempt: null };
  }
  const running = state.running;
  if (running && running.kind === KINDS.BACKGROUND) {
    const waiting = [...interactive, frozenJob, running, ...background];
    return { state: freezeState(waiting, null), preempt: running };
  }
  return { state: freezeState([...interactive, frozenJob, ...background], running), preempt: null };
}

/**
 * The job to start now, if any. → { state, job|null }. Nothing starts while a
 * job runs; background jobs only when `backgroundAllowed`.
 */
function takeNext(state, { backgroundAllowed = false } = {}) {
  if (state.running) return { state, job: null };
  const index = state.waiting.findIndex((j) => j.kind === KINDS.INTERACTIVE || backgroundAllowed);
  if (index < 0) return { state, job: null };
  const job = state.waiting[index];
  const waiting = state.waiting.filter((_, i) => i !== index);
  return { state: freezeState(waiting, job), job };
}

/** The running job ended (done or failed). A preempted job is no longer running: no-op. */
function finish(state, id) {
  if (!state.running || state.running.id !== id) return state;
  return freezeState(state.waiting, null);
}

/** Drop a waiting job (cancelled before it ran). */
function remove(state, id) {
  if (!state.waiting.some((j) => j.id === id)) return state;
  return freezeState(
    state.waiting.filter((j) => j.id !== id),
    state.running
  );
}

/** max_tokens for a background call: the request, capped by its purpose (map 512, reduce 1024). */
function capBackgroundTokens(requested, purpose) {
  const cap = BACKGROUND_TOKEN_CAPS[purpose] ?? BACKGROUND_TOKEN_CAPS.map;
  return Number.isInteger(requested) && requested > 0 ? Math.min(requested, cap) : cap;
}

module.exports = {
  KINDS,
  BACKGROUND_TOKEN_CAPS,
  createQueue,
  enqueue,
  takeNext,
  finish,
  remove,
  capBackgroundTokens,
};
