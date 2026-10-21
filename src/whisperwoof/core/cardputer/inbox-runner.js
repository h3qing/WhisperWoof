/**
 * The Cardputer inbox's work loop, without Electron: find session folders
 * that have a valid manifest.json and no result.json, refuse the bad ones,
 * and process the rest one at a time (memos first), with status.json along
 * the way and retries with back-off. bridge/cardputer-inbox.js runs it on
 * start, on file changes and every 30 s.
 */

const pure = require("../../bridge/cardputer-inbox-pure");
const writeback = require("../../bridge/cardputer-writeback");
const contract = require("./contract");
const files = require("./session-files");
const { processSession } = require("./process-session");

function defaultTzOffsetMin() {
  return -new Date().getTimezoneOffset();
}

function noTranscriber() {
  throw Object.assign(new Error("No transcriber"), { cardputerCode: "E_STT" });
}

/** The transcript-level result.json (no summaries in this build). */
function transcriptOnly(deps) {
  return ({ ctx, outputs }) =>
    pure.transcriptResult({
      manifest: ctx.manifest,
      outputs,
      app: deps.app,
      finishedAt: deps.at(),
    });
}

const DEFAULTS = Object.freeze({
  transcribe: noTranscriber,
  ensureModel: async () => false,
  postProcess: (text) => text,
  gateDelayMs: () => 0,
  now: Date.now,
  tzOffsetMin: defaultTzOffsetMin,
  app: "WhisperWoof",
  silenceRms: pure.CARDPUTER_SILENCE_RMS,
  write: writeback.writeAtomic,
  onDone: () => {},
});

function withDefaults(options) {
  const base = { ...DEFAULTS, ...options };
  const withClock = { ...base, at: () => pure.rfc3339(base.now(), base.tzOffsetMin()) };
  return Object.freeze({ ...withClock, complete: options.complete || transcriptOnly(withClock) });
}

function isAbort(error) {
  return error?.name === "AbortError";
}

// rt (runner state): { deps, memory: Map(session dir -> { status, failures, nextAt }), controller }

function remember(rt, dir, patch) {
  rt.memory.set(dir, { failures: 0, nextAt: 0, status: null, ...rt.memory.get(dir), ...patch });
}

function statusSetter(rt, dir, identity) {
  return async (state, reason = null) => {
    const next = { state, reason };
    if (!pure.statusChanged(rt.memory.get(dir)?.status, next)) return;
    writeback.assertOpen(dir);
    const doc = pure.statusDoc({ ...identity, state, reason, at: rt.deps.at() });
    rt.deps.write(dir, "status.json", `${JSON.stringify(doc, null, 2)}\n`);
    remember(rt, dir, { status: next });
  };
}

/**
 * A session folder that disappears (deleted, or moved to the Trash) at any
 * point cancels its session: nothing more is written, nothing is recreated,
 * and it is forgotten after one "cancelled" outcome.
 */
function isCancel(error, dir) {
  return writeback.isGone(error) || writeback.folderGone(dir);
}

function cancel(rt, dir) {
  rt.memory.delete(dir);
  return { kind: "cancelled", dir };
}

/** Sessions remembered from an earlier pass whose folder has gone since. */
function forgetGone(rt, listed) {
  const seen = new Set(listed);
  return [...rt.memory.keys()]
    .filter((dir) => !seen.has(dir) && writeback.folderGone(dir))
    .map((dir) => cancel(rt, dir));
}

function writeFailed(rt, dir, identity, code, retryable) {
  writeback.assertOpen(dir);
  const result = pure.failedResult({ identity, code, retryable, finishedAt: rt.deps.at() });
  rt.deps.write(dir, writeback.RESULT, `${JSON.stringify(result, null, 2)}\n`);
  rt.memory.delete(dir);
  return { kind: "failed", dir, session: identity.session, code };
}

/** → { candidate } | { outcome } (refused) | {} (ignored, or nothing to do). */
async function examine(rt, dir) {
  const found = await files.readManifest(dir);
  if (found.state === "done") rt.memory.delete(dir);
  if (found.state !== "manifest") return {};
  const identity = pure.failureIdentity(found.data);
  const verdict = contract.validateDoc("manifest", found.data);
  if (verdict.code !== "ok") {
    return identity ? { outcome: writeFailed(rt, dir, identity, verdict.code, false) } : {};
  }
  if (pure.tooLong(found.data))
    return { outcome: writeFailed(rt, dir, identity, "E_INVALID", false) };
  const segments = await files.inspectSegments(dir, found.data);
  if (segments.ignore) return {};
  if (segments.code) return { outcome: writeFailed(rt, dir, identity, segments.code, false) };
  return { candidate: { dir, manifest: found.data, mode: found.data.mode, identity } };
}

async function discover(rt) {
  const candidates = [];
  const outcomes = [];
  const listed = await files.listSessionDirs(rt.deps.root);
  for (const dir of listed) {
    try {
      const { candidate, outcome } = await examine(rt, dir);
      if (outcome) outcomes.push(outcome);
      if (!candidate) continue;
      if (!rt.memory.get(dir)?.status) await statusSetter(rt, dir, candidate.identity)("queued");
      candidates.push(candidate);
    } catch (error) {
      if (writeback.isTaken(error)) continue;
      outcomes.push(
        isCancel(error, dir)
          ? cancel(rt, dir)
          : { kind: "error", dir, code: pure.classifyError(error).code }
      );
    }
  }
  return { candidates, outcomes: [...outcomes, ...forgetGone(rt, listed)] };
}

async function failOrRetry(rt, candidate, error, setStatus) {
  const { code, retryable } = pure.classifyError(error);
  const failures = (rt.memory.get(candidate.dir)?.failures ?? 0) + 1;
  if (retryable && failures <= pure.MAX_RETRIES) {
    remember(rt, candidate.dir, {
      failures,
      nextAt: rt.deps.now() + pure.retryDelayMs(failures - 1),
    });
    await setStatus("queued");
    return { kind: "retry", dir: candidate.dir, code };
  }
  return writeFailed(rt, candidate.dir, candidate.identity, code, retryable);
}

async function runSession(rt, candidate, signal) {
  const setStatus = statusSetter(rt, candidate.dir, candidate.identity);
  const ctx = {
    dir: candidate.dir,
    manifest: candidate.manifest,
    deps: rt.deps,
    signal,
    setStatus,
  };
  try {
    const outcome = await processSession(ctx);
    if (outcome.kind === "done") {
      rt.memory.delete(candidate.dir);
      rt.deps.onDone(outcome);
    }
    return { ...outcome, dir: candidate.dir };
  } catch (error) {
    if (writeback.isTaken(error)) return { kind: "taken", dir: candidate.dir };
    if (isCancel(error, candidate.dir)) return cancel(rt, candidate.dir);
    if (isAbort(error) || signal.aborted) {
      await setStatus("blocked", "disabled").catch(() => {});
      return { kind: "stopped", dir: candidate.dir };
    }
    return failOrRetry(rt, candidate, error, setStatus).catch((e) =>
      isCancel(e, candidate.dir)
        ? cancel(rt, candidate.dir)
        : { kind: "error", dir: candidate.dir, code: pure.classifyError(e).code }
    );
  }
}

/** One pass: discover, then process what is due. → outcomes, in order. */
async function runOnce(rt) {
  const controller = new AbortController();
  rt.controller = controller;
  const { candidates, outcomes } = await discover(rt);
  for (const candidate of pure.orderCandidates(candidates)) {
    if (controller.signal.aborted) break;
    if ((rt.memory.get(candidate.dir)?.nextAt ?? 0) > rt.deps.now()) continue;
    outcomes.push(await runSession(rt, candidate, controller.signal));
  }
  return outcomes;
}

/**
 * options: { root, transcribe, ensureModel, postProcess, gateDelayMs, now,
 * tzOffsetMin, app, silenceRms, write, complete, onDone }.
 * → { runOnce(): Promise<outcome[]>, abort() }
 */
function createInboxRunner(options) {
  const rt = { deps: withDefaults(options), memory: new Map(), controller: null };
  return {
    runOnce: () => runOnce(rt),
    abort: () => rt.controller?.abort(),
  };
}

module.exports = { createInboxRunner };
