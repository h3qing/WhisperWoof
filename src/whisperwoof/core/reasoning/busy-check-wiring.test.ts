/**
 * Background reasoning (Cardputer transcription and summaries) waits while
 * WhisperWoof's own meeting records, or its local transcription is still
 * finishing. main.js installs that check on the shared LocalReasoningService
 * at startup, next to the clipboard reader's meeting check; without it the
 * service's busy check is always false.
 */
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
const WIRING = 'require("./src/services/localReasoningBridge").default.setBusyCheck(';

/** The function main.js passes to setBusyCheck, as source. */
function busyCheckSource() {
  const start = main.indexOf(WIRING);
  if (start < 0) return null;
  const match = main.slice(start + WIRING.length).match(/^\s*(\(\) =>[\s\S]*?)\n {2}\);/);
  return match ? match[1] : null;
}

type Handlers = { isMeetingRecording?: () => boolean; isLocalMeetingRecording?: () => boolean };

function busyCheckWith(handlers: Handlers | null): unknown {
  const source = busyCheckSource();
  expect(source).not.toBeNull();
  const make = new Function("ipcHandlers", `return ${source};`) as (
    h: Handlers | null
  ) => () => unknown;
  return make(handlers)();
}

describe("main.js wires the meeting check into background reasoning", () => {
  it("installs it on the shared service once WhisperWoof's subsystems have started", () => {
    const init = main.indexOf("await initializeWhisperWoof();");
    expect(init).toBeGreaterThan(-1);
    expect(main.indexOf(WIRING)).toBeGreaterThan(init);
    expect(main.split(".setBusyCheck(")).toHaveLength(2); // installed once
  });

  it("is busy while a meeting records, or while a local meeting finishes its last clip", () => {
    const off = () => false;
    const on = () => true;
    expect(busyCheckWith({ isMeetingRecording: on, isLocalMeetingRecording: off })).toBe(true);
    expect(busyCheckWith({ isMeetingRecording: off, isLocalMeetingRecording: on })).toBe(true);
    expect(busyCheckWith({ isMeetingRecording: off, isLocalMeetingRecording: off })).toBe(false);
  });

  it("is not busy before the IPC handlers exist", () => {
    expect(busyCheckWith(null)).toBe(false);
    expect(busyCheckWith({})).toBe(false);
  });
});
