/**
 * Pure decision logic for how long recorded audio stays on disk.
 *
 * Two stores: dictation audio (userData/audio/*.webm, kept for the Audio
 * Retention setting the renderer syncs to main) and the meeting crash buffer
 * (<temp>/meeting-audio-<uuid>/, which exists only until the meeting's
 * transcript is saved). ipcHandlers.js and meetingAudioBuffer.js own the file
 * system; everything that decides *what to delete* is here.
 */

const path = require("path");

const DAY_MS = 24 * 60 * 60 * 1000;

// A crash buffer left behind (crash, quit mid-meeting, abnormal end) stays
// this long for manual recovery, then the sweep removes it.
const STALE_MEETING_AUDIO_MS = DAY_MS;

const MEETING_AUDIO_DIR_RE =
  /^meeting-audio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Audio Retention setting as a whole number of days (0 = Disabled), or
 * null when the value can't be trusted. Accepts numeric strings because the
 * renderer store round-trips through localStorage.
 */
function normalizeAudioRetentionDays(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 ? days : null;
}

/**
 * Dictation audio last modified before this time is expired. Null means no
 * sweep: Disabled (0) keeps what is already stored, and null (renderer not
 * synced yet) must not fall back to a default, or a 60/90-day choice would be
 * cut short on every launch.
 */
function audioRetentionCutoffMs(retentionDays, nowMs) {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return null;
  return nowMs - retentionDays * DAY_MS;
}

/** Disabled stores no new dictation audio; unknown keeps today's behaviour. */
function shouldStoreAudio(retentionDays) {
  return retentionDays !== 0;
}

/**
 * Whether a finished meeting's crash buffer stays on disk. Only an abnormal
 * end (stop failed, transcript not persisted, audio the transcriber never got)
 * that actually captured audio is worth keeping; otherwise the transcript is
 * the record and the plaintext audio goes.
 */
function shouldKeepMeetingAudio({ endedCleanly, files }) {
  return !endedCleanly && Array.isArray(files) && files.length > 0;
}

/**
 * Whether a buffered meeting chunk never reached the transcriber: no stream,
 * or one that refused it (dropped, rotated out, mid-reconnect). A stream still
 * connecting refuses too but holds the chunk in its cold-start buffer.
 */
function chunkMissedTranscriber(streaming, sent) {
  if (!streaming) return true;
  return !sent && !streaming.isConnecting;
}

function isMeetingAudioDirName(name) {
  return typeof name === "string" && MEETING_AUDIO_DIR_RE.test(name);
}

/**
 * Whether a folder may be deleted as a meeting crash buffer: a
 * meeting-audio-<uuid> folder directly inside the buffer's base dir, never the
 * meeting being recorded. Anything else (a path outside, a parent, a
 * traversal) is refused.
 *
 * @param {unknown} dir
 * @param {{ baseDir: string, activeDir?: string|null }} options
 */
function isRemovableMeetingAudioDir(dir, { baseDir, activeDir = null }) {
  if (typeof dir !== "string" || dir === "") return false;
  const target = path.resolve(dir);
  if (activeDir && target === path.resolve(activeDir)) return false;
  return (
    path.dirname(target) === path.resolve(baseDir) &&
    isMeetingAudioDirName(path.basename(target))
  );
}

/**
 * Names of crash-buffer folders to delete: meeting-audio-<uuid> directories
 * untouched for maxAgeMs, never the meeting being recorded.
 *
 * @param {ReadonlyArray<{ name: string, isDirectory: boolean, mtimeMs: number }>} entries
 * @param {{ nowMs: number, maxAgeMs?: number, activeName?: string|null }} options
 * @returns {string[]}
 */
function findStaleMeetingAudioDirs(
  entries,
  { nowMs, maxAgeMs = STALE_MEETING_AUDIO_MS, activeName = null }
) {
  return entries
    .filter(
      (entry) =>
        entry.isDirectory &&
        isMeetingAudioDirName(entry.name) &&
        entry.name !== activeName &&
        nowMs - entry.mtimeMs >= maxAgeMs
    )
    .map((entry) => entry.name);
}

module.exports = {
  DAY_MS,
  STALE_MEETING_AUDIO_MS,
  normalizeAudioRetentionDays,
  audioRetentionCutoffMs,
  shouldStoreAudio,
  shouldKeepMeetingAudio,
  chunkMissedTranscriber,
  isMeetingAudioDirName,
  isRemovableMeetingAudioDir,
  findStaleMeetingAudioDirs,
};
