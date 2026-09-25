/**
 * Integration tests for the main-process side of audio retention: the real
 * IPCHandlers methods, MeetingAudioBuffer and AudioStorageManager on a temp
 * directory. IPCHandlers can't be constructed here (its CommonJS
 * require("electron") isn't mockable), so each test builds an instance from
 * the prototype with only the fields these methods use.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const load = async (p: string) => {
  const m = await import(p);
  return (m.default ?? m) as any;
};
const IPCHandlers = await load("../../../helpers/ipcHandlers");
const MeetingAudioBuffer = await load("../../../helpers/meetingAudioBuffer");
const AudioStorageManager = await load("../../../helpers/audioStorage");

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_UUID = "0b6e3a52-9d1c-4f0e-8a51-3c2f7d9e1a44";

function age(filePath: string, ms: number) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(filePath, t, t);
}

describe("main-process audio retention", () => {
  let tmpDir: string;
  let audioDir: string;
  let handlers: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-audio-retention-"));
    audioDir = path.join(tmpDir, "audio");
    fs.mkdirSync(audioDir);

    const audioStorageManager = Object.create(AudioStorageManager.prototype);
    audioStorageManager.audioDir = audioDir;

    handlers = Object.create(IPCHandlers.prototype);
    handlers.audioStorageManager = audioStorageManager;
    handlers.databaseManager = { db: {}, clearAudioFlags: vi.fn() };
    handlers._meetingAudioBuffer = new MeetingAudioBuffer(tmpDir);
    handlers._audioRetentionDays = null;
  });

  afterEach(() => {
    if (handlers._audioCleanupInterval) clearInterval(handlers._audioCleanupInterval);
    if (handlers._meetingAudioBuffer.isActive) handlers._meetingAudioBuffer.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function storedAudio(id: number, ageDays: number) {
    const file = path.join(audioDir, `OpenWhispr-2026-01-01-00-00-00-${id}.webm`);
    fs.writeFileSync(file, "webm");
    age(file, ageDays * DAY_MS);
    return file;
  }

  describe("Audio Retention setting", () => {
    it("sweeps nothing before the renderer has synced the setting", () => {
      const old = storedAudio(1, 45);
      handlers._sweepExpiredAudio();
      expect(fs.existsSync(old)).toBe(true);
    });

    it("sweeps with the synced period as soon as it arrives", () => {
      const expired = storedAudio(1, 10);
      const fresh = storedAudio(2, 3);

      handlers._applyAudioRetentionDays(7);

      expect(fs.existsSync(expired)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      expect(handlers.databaseManager.clearAudioFlags).toHaveBeenCalledWith(["1"]);
    });

    it("waits while encryption has the database closed, then sweeps on unlock", () => {
      const expired = storedAudio(1, 10);
      handlers.databaseManager.db = null;
      handlers._applyAudioRetentionDays(7);
      expect(fs.existsSync(expired)).toBe(true);

      handlers.databaseManager.db = {};
      handlers._setupAudioCleanup();
      handlers.runAudioSweep();
      expect(fs.existsSync(expired)).toBe(false);
      expect(handlers.databaseManager.clearAudioFlags).toHaveBeenCalledWith(["1"]);
    });

    it("keeps 45-day-old audio for a user on 60 days (no hard-coded 30)", () => {
      const kept = storedAudio(1, 45);
      handlers._applyAudioRetentionDays(60);
      expect(fs.existsSync(kept)).toBe(true);
    });

    it("Disabled deletes nothing already stored", () => {
      const old = storedAudio(1, 400);
      handlers._applyAudioRetentionDays(0);
      expect(fs.existsSync(old)).toBe(true);
      expect(handlers._audioRetentionDays).toBe(0);
    });

    it("re-syncing the same value does not sweep again", () => {
      const spy = vi.spyOn(handlers.audioStorageManager, "cleanupExpiredAudio");
      handlers._applyAudioRetentionDays(30);
      handlers._applyAudioRetentionDays("30");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("ignores a malformed value and keeps the last good one", () => {
      handlers._applyAudioRetentionDays(14);
      handlers._applyAudioRetentionDays(undefined);
      handlers._applyAudioRetentionDays(-3);
      expect(handlers._audioRetentionDays).toBe(14);
    });
  });

  describe("meeting crash buffer", () => {
    function recordMeeting() {
      handlers._meetingAudioBuffer.start();
      handlers._meetingAudioBuffer.writeChunk(Buffer.alloc(480), "mic");
      handlers._meetingAudioBuffer.writeChunk(Buffer.alloc(480), "system");
      return handlers._meetingAudioBuffer.stop({ keepFiles: true });
    }

    it("deletes the buffer once a meeting ends cleanly", () => {
      const result = recordMeeting();
      expect(handlers._releaseMeetingAudio(result, true)).toBe(false);
      expect(fs.existsSync(result.dir)).toBe(false);
    });

    it("keeps the buffer when the meeting ended abnormally", () => {
      const result = recordMeeting();
      expect(handlers._releaseMeetingAudio(result, false)).toBe(true);
      expect(fs.readdirSync(result.dir).sort()).toEqual(["mic-0000.wav", "system-0000.wav"]);
    });

    it("deletes an abnormal meeting's folder that captured no audio", () => {
      handlers._meetingAudioBuffer.start();
      const result = handlers._meetingAudioBuffer.stop({ keepFiles: true });
      expect(handlers._releaseMeetingAudio(result, false)).toBe(false);
      expect(fs.existsSync(result.dir)).toBe(false);
    });

    it("is a no-op when no meeting was buffered", () => {
      expect(handlers._releaseMeetingAudio(handlers._meetingAudioBuffer.stop(), true)).toBe(false);
    });
  });

  describe("startup", () => {
    it("sweeps stale meeting buffers but leaves dictation audio for the first sync", () => {
      const stale = path.join(tmpDir, `meeting-audio-${STALE_UUID}`);
      fs.mkdirSync(stale);
      age(stale, 2 * DAY_MS);
      const dictation = storedAudio(1, 400);

      handlers._setupAudioCleanup();

      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(dictation)).toBe(true);
    });
  });
});
