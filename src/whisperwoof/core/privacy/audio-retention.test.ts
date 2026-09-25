/**
 * Tests for the audio-retention decisions main makes: the dictation-audio
 * cutoff from the synced setting, and which meeting crash-buffer folders to
 * keep or sweep.
 *
 * Imports the real bridge module ipcHandlers.js and meetingAudioBuffer.js use.
 */
import { describe, it, expect } from "vitest";
import * as retention from "../../bridge/audio-retention-pure.js";

const {
  DAY_MS,
  STALE_MEETING_AUDIO_MS,
  normalizeAudioRetentionDays,
  audioRetentionCutoffMs,
  shouldStoreAudio,
  shouldKeepMeetingAudio,
  chunkMissedTranscriber,
  isMeetingAudioDirName,
  findStaleMeetingAudioDirs,
} = retention;

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const UUID = "0b6e3a52-9d1c-4f0e-8a51-3c2f7d9e1a44";
const OTHER_UUID = "c2d4f6a8-1b3d-4e5f-9a7b-8c6d4e2f0a1b";

describe("normalizeAudioRetentionDays", () => {
  it("accepts the settings options, Disabled included", () => {
    for (const days of [0, 7, 14, 30, 60, 90]) {
      expect(normalizeAudioRetentionDays(days)).toBe(days);
    }
  });

  it("accepts the numeric strings localStorage hands back", () => {
    expect(normalizeAudioRetentionDays("60")).toBe(60);
    expect(normalizeAudioRetentionDays("0")).toBe(0);
  });

  it("rejects anything that is not a whole number of days", () => {
    for (const bad of [undefined, null, "", "abc", -1, 1.5, NaN, Infinity, {}, [30], true]) {
      expect(normalizeAudioRetentionDays(bad)).toBeNull();
    }
  });
});

describe("audioRetentionCutoffMs", () => {
  it("deletes audio older than the chosen number of days", () => {
    expect(audioRetentionCutoffMs(30, NOW)).toBe(NOW - 30 * DAY_MS);
    expect(audioRetentionCutoffMs(7, NOW)).toBe(NOW - 7 * DAY_MS);
  });

  it("never sweeps when retention is Disabled", () => {
    expect(audioRetentionCutoffMs(0, NOW)).toBeNull();
  });

  it("never sweeps before the renderer has synced the setting", () => {
    // A default cutoff here would delete audio a user chose to keep 60/90 days.
    expect(audioRetentionCutoffMs(null, NOW)).toBeNull();
    expect(audioRetentionCutoffMs(undefined, NOW)).toBeNull();
  });

  it("never sweeps on a malformed value", () => {
    expect(audioRetentionCutoffMs(-5, NOW)).toBeNull();
    expect(audioRetentionCutoffMs(2.5, NOW)).toBeNull();
    expect(audioRetentionCutoffMs("30", NOW)).toBeNull();
  });
});

describe("shouldStoreAudio", () => {
  it("stores nothing when retention is Disabled", () => {
    expect(shouldStoreAudio(0)).toBe(false);
  });

  it("stores audio for any retention period", () => {
    expect(shouldStoreAudio(7)).toBe(true);
    expect(shouldStoreAudio(90)).toBe(true);
  });

  it("keeps storing until the setting is known (the sweep catches up)", () => {
    expect(shouldStoreAudio(null)).toBe(true);
  });
});

describe("shouldKeepMeetingAudio", () => {
  const files = ["/tmp/meeting-audio-x/mic-0000.wav"];

  it("deletes the buffer when the meeting ended cleanly", () => {
    expect(shouldKeepMeetingAudio({ endedCleanly: true, files })).toBe(false);
  });

  it("keeps the buffer when the meeting ended abnormally", () => {
    expect(shouldKeepMeetingAudio({ endedCleanly: false, files })).toBe(true);
  });

  it("deletes an abnormal meeting's folder when no audio reached it", () => {
    expect(shouldKeepMeetingAudio({ endedCleanly: false, files: [] })).toBe(false);
    expect(shouldKeepMeetingAudio({ endedCleanly: false, files: undefined })).toBe(false);
  });
});

describe("chunkMissedTranscriber", () => {
  it("counts a chunk the stream accepted as transcribed", () => {
    expect(chunkMissedTranscriber({ isConnecting: false }, true)).toBe(false);
  });

  it("counts a chunk held while the stream is still connecting as transcribed", () => {
    // sendAudio returns false but keeps it in the cold-start buffer.
    expect(chunkMissedTranscriber({ isConnecting: true }, false)).toBe(false);
  });

  it("flags a chunk a dropped, rotated or reconnecting stream refused", () => {
    expect(chunkMissedTranscriber({ isConnecting: false }, false)).toBe(true);
  });

  it("flags a chunk with no stream to send it to", () => {
    expect(chunkMissedTranscriber(null, false)).toBe(true);
    expect(chunkMissedTranscriber(undefined, false)).toBe(true);
  });
});

describe("isMeetingAudioDirName", () => {
  it("matches the folders MeetingAudioBuffer creates", () => {
    expect(isMeetingAudioDirName(`meeting-audio-${UUID}`)).toBe(true);
    expect(isMeetingAudioDirName(`meeting-audio-${UUID.toUpperCase()}`)).toBe(true);
  });

  it("ignores anything else in the temp directory", () => {
    for (const name of [
      "meeting-audio-",
      "meeting-audio-test-Ab12Cd",
      `meeting-audio-${UUID}-extra`,
      `x-meeting-audio-${UUID}`,
      `meeting-audio-${UUID}/../..`,
      "com.apple.launchd.abc",
    ]) {
      expect(isMeetingAudioDirName(name)).toBe(false);
    }
  });
});

describe("findStaleMeetingAudioDirs", () => {
  const dir = (name: string, ageMs: number, isDirectory = true) => ({
    name,
    isDirectory,
    mtimeMs: NOW - ageMs,
  });

  it("sweeps buffer folders untouched for 24 hours", () => {
    const entries = [dir(`meeting-audio-${UUID}`, STALE_MEETING_AUDIO_MS + 1)];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW })).toEqual([`meeting-audio-${UUID}`]);
  });

  it("sweeps a folder exactly at the age limit", () => {
    const entries = [dir(`meeting-audio-${UUID}`, STALE_MEETING_AUDIO_MS)];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW })).toHaveLength(1);
  });

  it("keeps recent folders so a crash can still be recovered", () => {
    const entries = [dir(`meeting-audio-${UUID}`, STALE_MEETING_AUDIO_MS - 1)];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW })).toEqual([]);
  });

  it("never sweeps the meeting being recorded", () => {
    const entries = [
      dir(`meeting-audio-${UUID}`, 3 * DAY_MS),
      dir(`meeting-audio-${OTHER_UUID}`, 3 * DAY_MS),
    ];
    expect(
      findStaleMeetingAudioDirs(entries, { nowMs: NOW, activeName: `meeting-audio-${UUID}` })
    ).toEqual([`meeting-audio-${OTHER_UUID}`]);
  });

  it("ignores files, other temp folders and unreadable timestamps", () => {
    const entries = [
      dir(`meeting-audio-${UUID}`, 3 * DAY_MS, false),
      dir("meeting-audio-test-Ab12Cd", 3 * DAY_MS),
      dir("com.apple.launchd.abc", 3 * DAY_MS),
      { name: `meeting-audio-${OTHER_UUID}`, isDirectory: true, mtimeMs: NaN },
    ];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW })).toEqual([]);
  });

  it("treats a timestamp in the future as fresh", () => {
    const entries = [dir(`meeting-audio-${UUID}`, -DAY_MS)];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW })).toEqual([]);
  });

  it("honours a custom age limit", () => {
    const entries = [dir(`meeting-audio-${UUID}`, 2 * 60 * 60 * 1000)];
    expect(findStaleMeetingAudioDirs(entries, { nowMs: NOW, maxAgeMs: 60 * 60 * 1000 })).toEqual([
      `meeting-audio-${UUID}`,
    ]);
  });

  it("does not mutate its input", () => {
    const entries = Object.freeze([Object.freeze(dir(`meeting-audio-${UUID}`, 3 * DAY_MS))]);
    expect(() => findStaleMeetingAudioDirs(entries, { nowMs: NOW })).not.toThrow();
  });
});
