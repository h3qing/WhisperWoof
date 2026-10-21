/**
 * Cardputer inbox — pure rules (docs/design/cardputer-inbox.md).
 *
 * cpad (cardputer-assistant's daemon) lands recordings in
 * <root>/<YYYY-MM-DD>/<session dir>/ and writes manifest.json last; WhisperWoof
 * transcribes them and writes status.json, transcript.json / .md and, last,
 * result.json (recording file contract v1). Everything read from the folder
 * is untrusted: these functions check it and build what is written back.
 */

const path = require("path");

const SAMPLE_RATE = 16000;
const HEADER_BYTES = 44;
// Speech from the Cardputer's microphone is quieter than a Mac's: 0.003 (the
// meeting default) would skip most of it. Calibrated on the device for its
// v0.3.1 mic gain (cardputer-assistant docs/releases/v0.3.1.md, HIL mic_cal):
// a quiet room's noise floor is ~0.0004 RMS (-68 dBFS), so 0.0005 let empty
// pieces through; 0.00084 is the dB midpoint between that floor and speech
// ~1 m from the device. Handheld speech is ~-35 dBFS (RMS ~0.018).
const CARDPUTER_SILENCE_RMS = 0.00084;
const MAX_SEGMENT_BYTES = 20 * 1024 * 1024;
const MAX_SESSION_MS = 4 * 3600 * 1000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const STT_ENGINE = "sensevoice-zh-en-int8-2024-07";
const STATES = Object.freeze(["queued", "transcribing", "summarizing", "blocked"]);
const BLOCK_REASONS = Object.freeze(["busy", "model_missing", "disabled"]);
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = Object.freeze([30_000, 120_000, 480_000]);
const MONO_ID = /^[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{4}$/;
// Error codes a later attempt may fix (a busy disk, a crashed model server).
const RETRYABLE = Object.freeze({
  E_IO: true,
  E_STT: true,
  E_LLM: true,
  E_AUDIO: false,
  E_INVALID: false,
  E_VERSION: false,
});

/** whisperwoof-settings.json `cardputerInbox` → { enabled (default off), root }. */
function normalizeInboxSettings(raw, homeDir) {
  const fallback = path.join(homeDir, "CardputerNotes", "recordings");
  const root = raw?.root;
  const usable = typeof root === "string" && path.isAbsolute(root) && !root.includes("\0");
  return Object.freeze({
    enabled: raw?.enabled === true,
    root: usable ? path.normalize(root) : fallback,
  });
}

const WAV_FIELDS = Object.freeze([
  [0, "ascii", "RIFF"],
  [8, "ascii", "WAVE"],
  [12, "ascii", "fmt "],
  [16, "u32", 16],
  [20, "u16", 1], // PCM
  [22, "u16", 1], // mono
  [24, "u32", SAMPLE_RATE],
  [28, "u32", SAMPLE_RATE * 2],
  [32, "u16", 2],
  [34, "u16", 16],
  [36, "ascii", "data"],
]);

function readField(buf, offset, kind) {
  if (kind === "ascii") return buf.toString("ascii", offset, offset + 4);
  return kind === "u16" ? buf.readUInt16LE(offset) : buf.readUInt32LE(offset);
}

/** The canonical 44-byte header of a 16 kHz / 16-bit / mono PCM file of `fileSize` bytes. */
function parseWavHeader(buf, fileSize) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_BYTES) return { ok: false, problem: "short" };
  const wrong = WAV_FIELDS.find(([offset, kind, want]) => readField(buf, offset, kind) !== want);
  if (wrong) return { ok: false, problem: `field@${wrong[0]}` };
  const dataBytes = buf.readUInt32LE(40);
  if (buf.readUInt32LE(4) !== fileSize - 8 || dataBytes !== fileSize - HEADER_BYTES) {
    return { ok: false, problem: "length" };
  }
  return { ok: true, dataBytes };
}

const invalid = (problem) => Object.freeze({ code: "E_INVALID", problem });

/**
 * One manifest segment against its file: `stat` = { isSymbolicLink, isFile,
 * size } from lstat (null when missing), `header` its first 44 bytes.
 * → null (fine) | { ignore: true } (a symlink: leave the session alone) | { code, problem }.
 */
function checkSegment(seg, stat, header) {
  if (stat?.isSymbolicLink) return Object.freeze({ ignore: true });
  if (!stat || !stat.isFile) return invalid("missing");
  if (stat.size > MAX_SEGMENT_BYTES) return invalid("too_big");
  if (stat.size !== seg.bytes) return invalid("size");
  const parsed = parseWavHeader(header, stat.size);
  if (!parsed.ok || parsed.dataBytes !== seg.samples * 2) return invalid("header");
  return null;
}

/** More than 4 hours of audio in the session. */
function tooLong(manifest) {
  const samples = manifest.segments.reduce((sum, s) => sum + s.samples, 0);
  return (samples / SAMPLE_RATE) * 1000 > MAX_SESSION_MS || manifest.duration_ms > MAX_SESSION_MS;
}

/**
 * What to feed the transcriber: one run per stretch of contiguous segments
 * (a gap starts a new run). Each run's zeroMs is the session time of its
 * first fed sample, so line times come out as session t_ms. Segment 0's
 * first lead_ms (the codec's start-up thump) is skipped.
 * → [{ zeroMs, parts: [{ file, offset, length }] }] (byte offsets in the file).
 */
function planRuns(manifest) {
  const runs = manifest.segments.reduce((acc, seg) => {
    const skip = seg.i === 0 ? Math.min(manifest.lead_ms * (SAMPLE_RATE / 1000), seg.samples) : 0;
    const part = Object.freeze({
      file: seg.file,
      offset: HEADER_BYTES + skip * 2,
      length: (seg.samples - skip) * 2,
    });
    const last = acc[acc.length - 1];
    if (last && seg.i === last.lastI + 1) {
      return [...acc.slice(0, -1), { ...last, lastI: seg.i, parts: [...last.parts, part] }];
    }
    const zeroMs = seg.t0_ms + skip / (SAMPLE_RATE / 1000);
    return [...acc, { zeroMs, lastI: seg.i, parts: [part] }];
  }, []);
  return Object.freeze(
    runs.map(({ zeroMs, parts }) => Object.freeze({ zeroMs, parts: Object.freeze(parts) }))
  );
}

/** Who a failed result.json is about, or null when the manifest can't even say (then nothing is written). */
function failureIdentity(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { session, attempt, mode } = data;
  if (typeof session !== "string" || !MONO_ID.test(session)) return null;
  if (mode !== "memo" && mode !== "meeting") return null;
  const validAttempt = Number.isInteger(attempt) && attempt >= 1 && attempt <= 1000;
  return Object.freeze({ session, attempt: validAttempt ? attempt : 1, mode });
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** RFC 3339 with milliseconds and the given UTC offset in minutes (e.g. 480 for +08:00). */
function rfc3339(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60_000);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** status.json: queued | transcribing | summarizing | blocked (busy | model_missing | disabled). */
function statusDoc({ session, attempt, state, reason = null, at }) {
  if (!STATES.includes(state)) throw new Error(`Unknown status ${state}`);
  if (state === "blocked" && !BLOCK_REASONS.includes(reason))
    throw new Error("blocked needs a reason");
  return Object.freeze({
    v: 1,
    session,
    attempt,
    state,
    ...(state === "blocked" ? { reason } : {}),
    at,
  });
}

function statusChanged(previous, next) {
  if (!previous) return true;
  return previous.state !== next.state || (previous.reason ?? null) !== (next.reason ?? null);
}

function baseResult({ session, attempt, mode }, finishedAt) {
  return {
    v: 1,
    session,
    attempt,
    mode,
    title: null,
    memo: null,
    actions: [],
    finished_at: finishedAt,
  };
}

function failedResult({ identity, code, retryable, finishedAt }) {
  return Object.freeze({
    ...baseResult(identity, finishedAt),
    state: "failed",
    level: null,
    outputs: {},
    pipeline: null,
    error: { code, retryable },
  });
}

/** result.json when only the transcript was made (no local model, or W3 alone). */
function transcriptResult({ manifest, outputs, app, finishedAt }) {
  return Object.freeze({
    ...baseResult(manifest, finishedAt),
    state: "done",
    level: "transcript",
    outputs,
    pipeline: { app, stt: STT_ENGINE, llm: null, prompt: null },
    error: null,
  });
}

function retryDelayMs(failures) {
  return RETRY_DELAYS_MS[Math.min(Math.max(0, failures), RETRY_DELAYS_MS.length - 1)];
}

/** → { code, retryable } for a failure while processing a session. */
function classifyError(error) {
  const code = error?.cardputerCode;
  if (code && code in RETRYABLE) return { code, retryable: RETRYABLE[code] };
  return { code: "E_IO", retryable: true };
}

/** Memos first (they are short and wanted soon), then oldest first; a new array. */
function orderCandidates(list) {
  const rank = (c) => (c.mode === "memo" ? 0 : 1);
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)
  );
}

module.exports = {
  SAMPLE_RATE,
  HEADER_BYTES,
  CARDPUTER_SILENCE_RMS,
  MAX_SEGMENT_BYTES,
  MAX_MANIFEST_BYTES,
  STT_ENGINE,
  MAX_RETRIES,
  MONO_ID,
  normalizeInboxSettings,
  parseWavHeader,
  checkSegment,
  tooLong,
  planRuns,
  failureIdentity,
  rfc3339,
  statusDoc,
  statusChanged,
  failedResult,
  transcriptResult,
  retryDelayMs,
  classifyError,
  orderCandidates,
};
