import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
  startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
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

  return { engine, sent, windowManager, databaseManager, audioActivityDetector };
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

  it("startManualMeeting names the note after the title it's given, else 'New note'", async () => {
    await env.engine.startManualMeeting({ title: "Standup" });
    env.engine.stop();
    await env.engine.startManualMeeting();
    const titles = env.databaseManager.saveNote.mock.calls.map(([title]: [string]) => title);
    expect(titles).toEqual(["Standup", "New note"]);
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
      startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
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
      startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
    }
    const e = env.engine as unknown as EngineWithDeps;
    e.databaseManager.saveNote = vi.fn(() => ({ note: null }));

    expect(await e.startManualMeeting()).toBe(false);

    expect(e._meetingModeActive).toBe(false);
    const stateMessages = env.sent.filter((m) => m.channel === "meeting-state");
    const last = stateMessages[stateMessages.length - 1];
    expect((last.payload as { isRecording: boolean }).isRecording).toBe(false);
  });

  it("startManualMeeting resets meeting mode, and says so, when the database throws (locked)", async () => {
    interface EngineWithDeps {
      databaseManager: { saveNote: ReturnType<typeof vi.fn> };
      _meetingModeActive: boolean;
      startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
    }
    const e = env.engine as unknown as EngineWithDeps;
    e.databaseManager.saveNote = vi.fn(() => {
      throw new Error("Database not initialized");
    });

    expect(await e.startManualMeeting()).toBe(false);
    expect(e._meetingModeActive).toBe(false);
  });
});

describe("a meeting started from the Meetings tab", () => {
  interface EngineInternals {
    activeDetections: Map<string, unknown>;
    _notificationQueue: unknown[];
    _preMeetingNotifiedIds: Set<string>;
    _meetingModeActive: boolean;
    startManualMeeting: (options?: { title?: string; calendarEventId?: string }) => Promise<boolean>;
    handleNotificationResponse: (id: string, action: string) => Promise<void>;
    _showCalendarNotification: (event: { id: string; start_time: string; summary: string }) => void;
    _schedulePreMeetingNotification: () => void;
  }

  it("answers the meeting prompt showing or queued, and that event isn't prompted for again", async () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    e.activeDetections.set("det-1", { event: { summary: "Standup" } });
    e._notificationQueue.push({ source: "audio" });

    expect(await e.startManualMeeting({ title: "Standup", calendarEventId: "evt-1" })).toBe(true);

    expect(e.activeDetections.size).toBe(0);
    expect(e._notificationQueue).toEqual([]);
    expect(e._preMeetingNotifiedIds.has("evt-1")).toBe(true);
    expect(env.windowManager.dismissMeetingNotification).toHaveBeenCalled();
    expect(env.audioActivityDetector.resetPrompt).toHaveBeenCalled();
    env.engine.stop();
  });

  it("ignores a prompt's Start while a meeting is already open (no second note)", async () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    await e.startManualMeeting({ title: "Standup" });
    e.activeDetections.set("det-2", { event: { summary: "Standup" } });
    env.databaseManager.saveNote.mockClear();

    await e.handleNotificationResponse("det-2", "start");

    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(env.sent.filter((m) => m.channel === "navigate-to-meeting-note")).toHaveLength(1);
    env.engine.stop();
  });

  it("settles a reminder that comes due mid-meeting instead of firing it again at once", () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    e._meetingModeActive = true;
    const scheduled = vi.spyOn(e, "_schedulePreMeetingNotification").mockImplementation(() => {});

    e._showCalendarNotification({ id: "evt-2", start_time: new Date(Date.now() + 60_000).toISOString(), summary: "1:1" });

    expect(e._preMeetingNotifiedIds.has("evt-2")).toBe(true);
    expect(scheduled).toHaveBeenCalledTimes(1);
    env.engine.stop();
  });

  it("makes no note when the Meetings folder is missing", async () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    env.databaseManager.getMeetingsFolder.mockReturnValue(null as never);

    expect(await e.startManualMeeting({ title: "Standup" })).toBe(false);
    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(e._meetingModeActive).toBe(false);
    env.engine.stop();
  });
});

describe("a meeting prompt's Start while WhisperWoof is locked", () => {
  type Unlocked = "ready" | "waiting" | "declined";
  interface EngineInternals {
    activeDetections: Map<string, unknown>;
    preferences: { autoStart: boolean };
    _meetingModeActive: boolean;
    handleNotificationResponse: (id: string, action: string) => Promise<void>;
    setVaultGate: (gate: { ready: () => boolean; unlock: () => Promise<Unlocked> }) => void;
    startAfterUnlock: () => Promise<void>;
    takePendingNavigation: () => { noteId: number; trigger: string } | null;
    startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
    _showPrompt: (id: string, source: string, key: string, data: unknown, imminentEvent: unknown) => void;
    _schedulePreMeetingNotification: () => void;
  }

  function lockedEngine(unlock: () => Promise<Unlocked>, ready = () => false) {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    vi.spyOn(e, "_schedulePreMeetingNotification").mockImplementation(() => {});
    e.setVaultGate({ ready, unlock });
    e.activeDetections.set("det-1", { event: { summary: "Standup" } });
    return { env, e };
  }

  const navigations = (env: ReturnType<typeof buildEngine>) =>
    env.sent.filter((m) => m.channel === "navigate-to-meeting-note");
  const lastMeetingState = (env: ReturnType<typeof buildEngine>) =>
    env.sent.filter((m) => m.channel === "meeting-state").at(-1)?.payload as
      | { isRecording: boolean }
      | undefined;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("unlocks before the note is made, then starts the meeting", async () => {
    const order: string[] = [];
    const { env, e } = lockedEngine(async () => {
      order.push("unlock");
      return "ready";
    });
    env.databaseManager.saveNote.mockImplementation((title: string) => {
      order.push("save");
      return { note: { id: 42, title } };
    });

    await e.handleNotificationResponse("det-1", "start");

    expect(order).toEqual(["unlock", "save"]);
    expect(navigations(env)).toHaveLength(1);
    expect(e._meetingModeActive).toBe(true);
    expect(env.audioActivityDetector.resetPrompt).toHaveBeenCalled();
    env.engine.stop();
  });

  it("the prompt goes away while it unlocks, and a second click asks nothing more", async () => {
    let finish: (u: Unlocked) => void = () => {};
    const unlock = vi.fn(() => new Promise<Unlocked>((resolve) => (finish = resolve)));
    const { env, e } = lockedEngine(unlock);

    const first = e.handleNotificationResponse("det-1", "start");
    expect(env.windowManager.dismissMeetingNotification).toHaveBeenCalled();
    expect(e._meetingModeActive).toBe(true);
    await e.handleNotificationResponse("det-1", "start");
    finish("ready");
    await first;

    expect(unlock).toHaveBeenCalledTimes(1);
    expect(env.databaseManager.saveNote).toHaveBeenCalledTimes(1);
    expect(navigations(env)).toHaveLength(1);
    env.engine.stop();
  });

  it("waiting for the lock screen: no note yet, and no prompt again for a while", async () => {
    const { env, e } = lockedEngine(async () => "waiting");

    await e.handleNotificationResponse("det-1", "start");

    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(navigations(env)).toHaveLength(0);
    expect(e._meetingModeActive).toBe(false);
    expect(env.audioActivityDetector.dismiss).toHaveBeenCalled();
    expect(env.audioActivityDetector.resetPrompt).not.toHaveBeenCalled();
    expect(e.activeDetections.size).toBe(0);
    env.engine.stop();
  });

  it("starts the meeting once it's unlocked from the lock screen, and only once", async () => {
    const { env, e } = lockedEngine(async () => "waiting");
    await e.handleNotificationResponse("det-1", "start");

    await e.startAfterUnlock();
    await e.startAfterUnlock();

    expect(env.databaseManager.saveNote).toHaveBeenCalledTimes(1);
    expect(env.databaseManager.saveNote).toHaveBeenCalledWith("Standup", "", "meeting");
    expect(navigations(env)).toHaveLength(1);
    expect((navigations(env)[0].payload as { trigger: string }).trigger).toBe("calendar-join");
    env.engine.stop();
  });

  it("Touch ID cancelled: nothing starts on a later unlock", async () => {
    const { env, e } = lockedEngine(async () => "declined");
    await e.handleNotificationResponse("det-1", "start");

    await e.startAfterUnlock();

    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(env.audioActivityDetector.dismiss).toHaveBeenCalled();
    env.engine.stop();
  });

  it("an unlock just inside 5 minutes still starts it; one after starts nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const inside = lockedEngine(async () => "waiting");
    await inside.e.handleNotificationResponse("det-1", "start");
    const late = lockedEngine(async () => "waiting");
    await late.e.handleNotificationResponse("det-1", "start");

    vi.setSystemTime(1_000_000 + 5 * 60_000 - 1000);
    await inside.e.startAfterUnlock();
    vi.setSystemTime(1_000_000 + 6 * 60_000);
    await late.e.startAfterUnlock();

    expect(inside.env.databaseManager.saveNote).toHaveBeenCalledTimes(1);
    expect(late.env.databaseManager.saveNote).not.toHaveBeenCalled();
    inside.env.engine.stop();
    late.env.engine.stop();
  });

  it("a pending Start makes no second meeting when another one started first", async () => {
    const { env, e } = lockedEngine(async () => "waiting");
    await e.handleNotificationResponse("det-1", "start");
    e.activeDetections.set("det-2", { event: { summary: "1:1" } });
    e.setVaultGate({ ready: () => true, unlock: async () => "ready" });
    await e.handleNotificationResponse("det-2", "start");

    await e.startAfterUnlock();

    expect(env.databaseManager.saveNote).toHaveBeenCalledTimes(1);
    expect(env.databaseManager.saveNote).toHaveBeenCalledWith("1:1", "", "meeting");
    env.engine.stop();
  });

  it("the database still closed after the unlock: meeting mode resets, nothing opens", async () => {
    const { env, e } = lockedEngine(async () => "waiting");
    await e.handleNotificationResponse("det-1", "start");
    env.databaseManager.saveNote.mockImplementation(() => {
      throw new Error("Database not initialized");
    });

    await expect(e.startAfterUnlock()).resolves.toBeUndefined();

    expect(e._meetingModeActive).toBe(false);
    expect(lastMeetingState(env)?.isRecording).toBe(false);
    expect(navigations(env)).toHaveLength(0);
    env.engine.stop();
  });

  it("no Meetings folder: no note, and meeting mode doesn't stay on", async () => {
    const { env, e } = lockedEngine(async () => "ready");
    env.databaseManager.getMeetingsFolder.mockReturnValue(null as never);

    await e.handleNotificationResponse("det-1", "start");

    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(e._meetingModeActive).toBe(false);
    expect(lastMeetingState(env)?.isRecording).toBe(false);
    expect(navigations(env)).toHaveLength(0);
    expect(env.audioActivityDetector.dismiss).toHaveBeenCalled();
    expect(env.audioActivityDetector.resetPrompt).not.toHaveBeenCalled();
    env.engine.stop();
  });

  it("the unlock failing: meeting mode resets and the prompt closes", async () => {
    const { env, e } = lockedEngine(async () => {
      throw new Error("window failed");
    });

    await e.handleNotificationResponse("det-1", "start");

    expect(e._meetingModeActive).toBe(false);
    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    expect(env.windowManager.dismissMeetingNotification).toHaveBeenCalled();
    expect(e.activeDetections.size).toBe(0);
    env.engine.stop();
  });

  it("auto-start while locked shows the prompt instead of asking to unlock", () => {
    const unlock = vi.fn(async (): Promise<Unlocked> => "ready");
    const { env, e } = lockedEngine(unlock);
    const show = vi.fn();
    (env.windowManager as unknown as { showMeetingNotification: typeof show }).showMeetingNotification = show;
    e.preferences.autoStart = true;
    e.activeDetections.set("audio:sustained", { source: "audio" });

    e._showPrompt("audio:sustained", "audio", "sustained", {}, null);

    expect(show).toHaveBeenCalledTimes(1);
    expect(unlock).not.toHaveBeenCalled();
    env.engine.stop();
  });

  it("an unlock with nothing pending starts nothing", async () => {
    const { env, e } = lockedEngine(async () => "ready");

    await e.startAfterUnlock();

    expect(env.databaseManager.saveNote).not.toHaveBeenCalled();
    env.engine.stop();
  });
});

describe("the meeting note the control panel opens", () => {
  interface EngineInternals {
    activeDetections: Map<string, unknown>;
    handleNotificationResponse: (id: string, action: string) => Promise<void>;
    startManualMeeting: (options?: { title?: string }) => Promise<boolean>;
    takePendingNavigation: () => { noteId: number; folderId: number; trigger: string } | null;
    _schedulePreMeetingNotification: () => void;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is given once, so a page reloaded as it unlocked can still pick it up", async () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    vi.spyOn(e, "_schedulePreMeetingNotification").mockImplementation(() => {});
    e.activeDetections.set("det-1", { event: { summary: "Standup" } });

    await e.handleNotificationResponse("det-1", "start");

    expect(e.takePendingNavigation()).toMatchObject({ noteId: 42, folderId: 1, trigger: "calendar-join" });
    expect(e.takePendingNavigation()).toBeNull();
    env.engine.stop();
  });

  it("is also kept for a meeting started from the Meetings tab", async () => {
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;

    await e.startManualMeeting({ title: "Standup" });

    expect(e.takePendingNavigation()).toMatchObject({ noteId: 42, trigger: "manual" });
    env.engine.stop();
  });

  it("isn't opened a minute later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const env = buildEngine();
    const e = env.engine as unknown as EngineInternals;
    vi.spyOn(e, "_schedulePreMeetingNotification").mockImplementation(() => {});
    e.activeDetections.set("det-1", { event: { summary: "Standup" } });
    await e.handleNotificationResponse("det-1", "start");

    vi.setSystemTime(1_000_000 + 61_000);

    expect(e.takePendingNavigation()).toBeNull();
    env.engine.stop();
  });
});
