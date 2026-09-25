/**
 * The renderer can't ask main to delete a folder. The old meeting-audio-cleanup
 * channel handed a renderer-supplied path to fs.rmSync; main now deletes the
 * meeting crash buffer itself (_releaseMeetingAudio in ipcHandlers.js). Guards
 * against the channel coming back, e.g. in an upstream OpenWhispr merge.
 */
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("meeting audio cleanup IPC", () => {
  it("is not exposed to the renderer", () => {
    expect(read("preload.js")).not.toMatch(/meeting-audio-cleanup|meetingAudioCleanup/);
    expect(read("src/types/electron.ts")).not.toMatch(/meetingAudioCleanup/);
  });

  it("has no handler in main", () => {
    expect(read("src/helpers/ipcHandlers.js")).not.toMatch(/meeting-audio-cleanup/);
  });
});
