import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({
  default: {},
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => "/tmp" },
}));

vi.mock("../../../helpers/debugLogger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const MeetingDetectionEngineModule = await import("../../../helpers/meetingDetectionEngine");
type EngineCtor = new (...args: unknown[]) => {
  setMeetingModeActive: (active: boolean, payload?: { noteId?: number; noteTitle?: string; trigger?: string }) => void;
  startManualMeeting: () => Promise<void>;
  stop: () => void;
  _meetingModeActive: boolean;
  _meetingState: { isRecording: boolean; noteId: number | null; noteTitle: string | null; trigger: string | null };
};
const Engine = (MeetingDetectionEngineModule.default ?? MeetingDetectionEngineModule) as unknown as EngineCtor;

interface SentMessage {
  channel: string;
  payload: unknown;
}

function buildEngine() {
  const sent: SentMessage[] = [];

  const windowManager = {
    sendToControlPanel: vi.fn((channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    }),
    createControlPanelWindow: vi.fn(async () => {}),
    snapControlPanelToMeetingMode: vi.fn(),
    dismissMeetingNotification: vi.fn(),
  };

  const databaseManager = {
    saveNote: vi.fn((title: string) => ({ note: { id: 42, title } })),
    getMeetingsFolder: vi.fn(() => ({ id: 1 })),
  };

  const meetingProcessDetector = { on: vi.fn(), stop: vi.fn() };
  const audioActivityDetector = {
    on: vi.fn(),
    setMeetingAppRunning: vi.fn(),
    setUserRecording: vi.fn(),
    resetPrompt: vi.fn(),
    dismiss: vi.fn(),
    stop: vi.fn(),
  };
  const googleCalendarManager = {};

  const engine = new Engine(
    googleCalendarManager,
    meetingProcessDetector,
    audioActivityDetector,
    windowManager,
    databaseManager,
  );

  (engine as unknown as { broadcastToWindows: (...args: unknown[]) => void }).broadcastToWindows = vi.fn();

  return { engine, sent, windowManager, databaseManager };
}

describe("meeting-state IPC channel", () => {
  let env: ReturnType<typeof buildEngine>;

  beforeEach(() => {
    env = buildEngine();
  });

  it("does not emit on construction", () => {
    expect(env.sent.find((m) => m.channel === "meeting-state")).toBeUndefined();
  });

  it("emits {isRecording:true, ...payload} when meeting mode flips on", () => {
    env.engine.setMeetingModeActive(true, { noteId: 7, noteTitle: "Standup", trigger: "manual" });

    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    expect(stateMessages).toHaveLength(1);
    expect(stateMessages[0].payload).toEqual({
      isRecording: true,
      noteId: 7,
      noteTitle: "Standup",
      trigger: "manual",
    });
  });

  it("emits {isRecording:false, noteId:null, noteTitle:null, trigger:null} when meeting mode flips off", () => {
    env.engine.setMeetingModeActive(true, { noteId: 7, noteTitle: "Standup", trigger: "manual" });
    env.sent.length = 0;

    env.engine.setMeetingModeActive(false);

    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    expect(stateMessages).toHaveLength(1);
    expect(stateMessages[0].payload).toEqual({
      isRecording: false,
      noteId: null,
      noteTitle: null,
      trigger: null,
    });
  });

  it("startManualMeeting emits meeting-state AND navigate-to-meeting-note with trigger='manual'", async () => {
    await env.engine.startManualMeeting();

    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    expect(stateMessages.length).toBeGreaterThanOrEqual(1);
    const lastState = stateMessages[stateMessages.length - 1].payload as {
      isRecording: boolean;
      trigger: string | null;
    };
    expect(lastState.isRecording).toBe(true);
    expect(lastState.trigger).toBe("manual");

    const navMessages = env.sent.filter((m) => m.channel === "navigate-to-meeting-note");
    expect(navMessages).toHaveLength(1);
    expect((navMessages[0].payload as { trigger: string }).trigger).toBe("manual");
  });

  it("stop() emits meeting-state with isRecording=false (cleanup)", () => {
    env.engine.setMeetingModeActive(true, { noteId: 1, noteTitle: "X", trigger: "manual" });
    env.sent.length = 0;

    env.engine.stop();

    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    expect(stateMessages.length).toBeGreaterThanOrEqual(1);
    const last = stateMessages[stateMessages.length - 1].payload as { isRecording: boolean };
    expect(last.isRecording).toBe(false);
  });

  it("internal state mirrors what was emitted", () => {
    env.engine.setMeetingModeActive(true, { noteId: 99, noteTitle: "Sync", trigger: "calendar-join" });

    expect(env.engine._meetingModeActive).toBe(true);
    expect(env.engine._meetingState).toEqual({
      isRecording: true,
      noteId: 99,
      noteTitle: "Sync",
      trigger: "calendar-join",
    });
  });

  it("payload defaults to null fields when meeting mode flips on without payload", () => {
    env.engine.setMeetingModeActive(true);

    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    expect(stateMessages).toHaveLength(1);
    expect(stateMessages[0].payload).toEqual({
      isRecording: true,
      noteId: null,
      noteTitle: null,
      trigger: null,
    });
  });

  // Regression: ISSUE-QA-001 — race window where saveNote ran while
  // _meetingModeActive was still false, allowing a concurrent
  // _handleDetection call to start a second meeting.
  // Found by /qa on 2026-05-05.
  it("startManualMeeting flips _meetingModeActive synchronously before saveNote runs", async () => {
    interface EngineWithDeps {
      databaseManager: { saveNote: ReturnType<typeof vi.fn> };
      _meetingModeActive: boolean;
      startManualMeeting: () => Promise<void>;
    }
    const e = env.engine as unknown as EngineWithDeps;
    let flagDuringSaveNote: boolean | null = null;
    e.databaseManager.saveNote = vi.fn(() => {
      flagDuringSaveNote = e._meetingModeActive;
      return { note: { id: 42 } };
    });

    await e.startManualMeeting();

    expect(flagDuringSaveNote).toBe(true);
    expect(e._meetingModeActive).toBe(true);
  });

  // Regression: ISSUE-QA-001 — manual meeting saveNote failure left the
  // synchronous flag set, blocking all future detections.
  // Found by /qa on 2026-05-05.
  it("startManualMeeting resets _meetingModeActive when saveNote returns no note", async () => {
    interface EngineWithDeps {
      databaseManager: { saveNote: ReturnType<typeof vi.fn> };
      _meetingModeActive: boolean;
      startManualMeeting: () => Promise<void>;
    }
    const e = env.engine as unknown as EngineWithDeps;
    e.databaseManager.saveNote = vi.fn(() => ({ note: null }));

    await e.startManualMeeting();

    expect(e._meetingModeActive).toBe(false);
    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    const last = stateMessages[stateMessages.length - 1];
    expect((last.payload as { isRecording: boolean }).isRecording).toBe(false);
  });
});
