/**
 * One Cardputer session, from a checked manifest to result.json:
 * SenseVoice ready? → audio matches its sha256 → transcribe each run of
 * contiguous segments through MeetingLocalTranscriber (1 s at a time, waiting
 * whenever it queued a clip, and for the background gate before every piece)
 * → transcript.json → transcript.md → result.json, each written only while
 * result.json is still absent. Dependencies are passed in (see inbox-runner.js).
 */

const MeetingLocalTranscriber = require("../../../helpers/meetingLocalTranscriber");
const pure = require("../../bridge/cardputer-inbox-pure");
const { assertOpen, isGone, RESULT } = require("../../bridge/cardputer-writeback");
const { firstShaMismatch, readPart } = require("./session-files");
const transcriptDoc = require("./transcript-doc");

const GATE_POLL_MS = 1000;

function codedError(cardputerCode, message) {
  return Object.assign(new Error(message), { cardputerCode });
}

function abortError() {
  const error = new Error("Cardputer inbox stopped");
  error.name = "AbortError";
  return error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Throws when the inbox was stopped, result.json appeared or the folder is gone. */
function checkpoint(ctx) {
  if (ctx.signal.aborted) throw abortError();
  assertOpen(ctx.dir);
}

/** Waits while the gate is closed (dictation active), with status blocked/busy meanwhile. */
async function waitForGate(ctx) {
  let delay = ctx.deps.gateDelayMs();
  if (delay <= 0) return;
  await ctx.setStatus("blocked", "busy");
  while (delay > 0) {
    await sleep(Math.min(delay, GATE_POLL_MS));
    if (ctx.signal.aborted) throw abortError();
    delay = ctx.deps.gateDelayMs();
  }
  await ctx.setStatus("transcribing");
}

async function transcribeRun(ctx, run) {
  let gone = null; // the folder went: every piece left is skipped quietly, then this is thrown
  const transcriber = new MeetingLocalTranscriber({
    sampleRate: pure.SAMPLE_RATE,
    zeroMs: run.zeroMs,
    silenceRms: ctx.deps.silenceRms,
    transcribe: async (samples, sampleRate) => {
      if (gone) return null; // no model call, no failed piece, no warning
      try {
        await waitForGate(ctx);
        checkpoint(ctx);
      } catch (error) {
        if (!isGone(error)) throw error;
        gone = error;
        return null;
      }
      return ctx.deps.transcribe(samples, sampleRate);
    },
  });
  for (const part of run.parts) {
    for await (const chunk of readPart(ctx.dir, part)) {
      if (ctx.signal.aborted) throw abortError();
      if (transcriber.push("mic", chunk)) {
        await transcriber.idle();
        if (gone) throw gone;
        checkpoint(ctx); // a clip of silence never reaches the callback
      }
    }
  }
  const lines = await transcriber.finish();
  if (gone) throw gone; // even if the folder is back by now: never a transcript with holes
  checkpoint(ctx);
  if (transcriber.failedPieces > 0) {
    throw codedError("E_STT", `${transcriber.failedPieces} piece(s) failed to transcribe`);
  }
  return lines;
}

async function transcribeAll(ctx) {
  let lines = [];
  for (const run of pure.planRuns(ctx.manifest)) {
    lines = [...lines, ...(await transcribeRun(ctx, run))];
  }
  return transcriptDoc.buildSentences(lines, ctx.deps.postProcess);
}

/** Writes dir/name only while result.json is absent. → sha256 of what was written. */
function writeFile(ctx, name, data) {
  checkpoint(ctx);
  return ctx.deps.write(ctx.dir, name, data);
}

function writeTranscripts(ctx, sentences) {
  const { session, attempt, lead_ms: leadMs } = ctx.manifest;
  const json = transcriptDoc.transcriptJson({
    session,
    attempt,
    leadMs,
    sentences,
    stt: pure.STT_ENGINE,
  });
  const md = transcriptDoc.transcriptMarkdown({ session, sentences });
  return {
    transcript_json: {
      path: "transcript.json",
      sha256: writeFile(ctx, "transcript.json", `${JSON.stringify(json, null, 2)}\n`),
    },
    transcript_md: { path: "transcript.md", sha256: writeFile(ctx, "transcript.md", md) },
  };
}

/**
 * ctx: { dir, manifest (contract-valid, segments checked), deps, signal,
 *        setStatus(state, reason?) }.
 * → { kind: "done" | "blocked", ... }; throws AbortError, CARDPUTER_TAKEN,
 *   CARDPUTER_GONE (the folder is gone: cancelled), or an error carrying
 *   cardputerCode (E_INVALID, E_STT, E_AUDIO …) / an fs code.
 */
async function processSession(ctx) {
  if (!(await ctx.deps.ensureModel())) {
    await ctx.setStatus("blocked", "model_missing");
    return { kind: "blocked", reason: "model_missing" };
  }
  checkpoint(ctx);
  if ((await firstShaMismatch(ctx.dir, ctx.manifest)) >= 0) {
    throw codedError("E_INVALID", "Audio does not match its sha256");
  }
  await ctx.setStatus("transcribing");
  const sentences = await transcribeAll(ctx);
  const outputs = writeTranscripts(ctx, sentences);
  const result = await ctx.deps.complete({ ctx, sentences, outputs });
  writeFile(ctx, RESULT, `${JSON.stringify(result, null, 2)}\n`);
  return {
    kind: "done",
    session: ctx.manifest.session,
    mode: ctx.manifest.mode,
    level: result.level,
  };
}

module.exports = { processSession, abortError, codedError, writeFile };
