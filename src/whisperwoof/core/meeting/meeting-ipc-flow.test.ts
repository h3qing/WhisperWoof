/**
 * A meeting through the real IPC handlers (meeting-transcription-start/send/
 * stop and the stream handlers they attach), with OpenAI played by the fake
 * socket: what reaches the window and what stop returns across a 25 minute
 * session rotation.
 *
 * setupHandlers() runs against a fake ipcMain that records the handlers;
 * the audio buffer and checkpoint are stubs (they have their own tests).
 */
import { EventEmitter } from "events";
import { createRequire } from "module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { COMMIT_TRANSCRIPT, FakeWebSocket, injectModule, sockets } from "./fake-realtime-socket";

const require = createRequire(import.meta.url);

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
const sent: Array<[string, { text?: string; type?: string }]> = [];
const win = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, payload: never) => sent.push([channel, payload]) },
};
injectModule("ws", FakeWebSocket);
injectModule("electron", {
  ipcMain: {
    handle: (channel: string, fn: Handler) => ipc.set(channel, fn),
    on: (channel: string, fn: Handler) => ipc.set(channel, fn),
  },
  app: { getPath: () => "/tmp", getVersion: () => "0.0.0" },
  BrowserWindow: { fromWebContents: () => win, getAllWindows: () => [win] },
});
const IPCHandlers = require("../../../helpers/ipcHandlers");

const MIN = 60 * 1000;
// The control panel's webContents: it can close, reload, or navigate in-page.
const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
const event = { sender };
const flush = () => new Promise((resolve) => setImmediate(resolve));

const finals = () =>
  sent
    .filter(
      ([channel, data]) => channel === "meeting-transcription-segment" && data.type === "final"
    )
    .map(([, data]) => data.text);

describe("a meeting through the IPC handlers", () => {
  let handlers: any;

  beforeEach(() => {
    sender.removeAllListeners();
    ipc.clear();
    sent.length = 0;
    sockets.length = 0;
    handlers = Object.create(IPCHandlers.prototype);
    handlers.environmentManager = { getOpenAIKey: () => "sk-test-byok" };
    handlers._meetingAudioBuffer = {
      isActive: false,
      start() {
        this.isActive = true;
      },
      stop() {
        this.isActive = false;
        return { dir: null, files: [] };
      },
      writeChunk() {},
      getSessionDir: () => null,
    };
    handlers._meetingTranscriptCheckpoint = {
      isActive: false,
      forceCheckpoint() {},
      stop: () => ({ savedSegments: 0 }),
    };
    handlers._meetingReconnecting = {};
    handlers._meetingRotating = false;
    handlers._meetingStreamingGeneration = 0;
    handlers._meetingRetiredStreams = { mic: [], system: [] };
    handlers.setupHandlers();
  });

  afterEach(() => {
    handlers._stopMeetingSessionRotation();
  });

  async function startMeeting() {
    const result = await ipc.get("meeting-transcription-start")!(event, {
      provider: "openai-realtime",
      mode: "byok",
      model: "gpt-4o-mini-transcribe",
    });
    expect(result).toMatchObject({ success: true });
    return sockets.at(-1)!;
  }

  const speak = () => ipc.get("meeting-transcription-send")!(event, new Uint8Array(4800), "mic");

  it("stop returns the whole meeting's text after a rotation, and every line reached the window once", async () => {
    const first = await startMeeting();
    expect(first.bearer).toBe("sk-test-byok");
    speak();
    first.transcribes("minute one");

    handlers._meetingMicStreaming.connectedAt = Date.now() - 26 * MIN;
    await handlers._checkMeetingSessionRotation();
    const second = sockets.at(-1)!;
    expect(second).not.toBe(first);
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);

    speak();
    second.transcribes("minute twenty six");
    const stopped = await ipc.get("meeting-transcription-stop")!();

    expect(stopped).toMatchObject({
      success: true,
      transcript: `minute one ${COMMIT_TRANSCRIPT} minute twenty six ${COMMIT_TRANSCRIPT}`,
    });
    // The old session's last words (committed at the switch) reached the meeting too.
    expect(finals().slice(0, 3)).toEqual(["minute one", COMMIT_TRANSCRIPT, "minute twenty six"]);
  });

  it("does not repeat the last line when a rotation commits only silence", async () => {
    const first = await startMeeting();
    speak();
    first.transcribes("the last thing said");
    first.commitTranscript = ""; // nothing but silence left to commit

    handlers._meetingMicStreaming.connectedAt = Date.now() - 26 * MIN;
    await handlers._checkMeetingSessionRotation();
    await flush();

    expect(finals()).toEqual(["the last thing said"]);
  });

  it("starts the next meeting without the previous meeting's rotated-out text", async () => {
    const first = await startMeeting();
    speak();
    first.transcribes("old meeting");
    handlers._meetingMicStreaming.connectedAt = Date.now() - 26 * MIN;
    await handlers._checkMeetingSessionRotation();
    await ipc.get("meeting-transcription-stop")!();

    const next = await startMeeting();
    speak();
    next.transcribes("new meeting");
    const stopped = await ipc.get("meeting-transcription-stop")!();

    expect(stopped).toMatchObject({ transcript: `new meeting ${COMMIT_TRANSCRIPT}` });
  });

  it("reconnects at once when a session that had been up for a while drops", async () => {
    const first = await startMeeting();
    handlers._meetingMicStreaming.connectedAt = Date.now() - 10 * MIN;

    first.drop();

    expect(handlers._meetingReconnecting.mic).toBe(true);
  });

  it("leaves a session that drops within a minute to the next 30s check", async () => {
    const first = await startMeeting();

    first.drop(); // accepted, then closed straight away (e.g. a server-side limit)

    expect(handlers._meetingReconnecting.mic).toBeFalsy();
    await handlers._checkMeetingSessionRotation();
    expect(sockets).toHaveLength(2);
    expect(handlers._meetingMicStreaming.isConnected).toBe(true);
  });

  it("stops the meeting when the window that runs it closes", async () => {
    const first = await startMeeting();

    sender.emit("destroyed");
    await flush();

    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(handlers._meetingMicStreaming).toBeNull();
    expect(handlers._meetingStreamingStartedAt).toBeNull(); // no more rotation checks
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
  });

  it("stops it when that window reloads, but not for navigation within the page", async () => {
    const first = await startMeeting();

    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    sender.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    await flush();
    expect(handlers._meetingMicStreaming.isConnected).toBe(true);

    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    await flush();
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(handlers._meetingMicStreaming).toBeNull();
  });

  it("stops watching the window once the meeting is stopped", async () => {
    await startMeeting();
    expect(sender.listenerCount("destroyed")).toBe(1);

    await ipc.get("meeting-transcription-stop")!();

    expect(sender.listenerCount("destroyed")).toBe(0);
    expect(sender.listenerCount("did-start-navigation")).toBe(0);
    expect(sender.listenerCount("render-process-gone")).toBe(0);
  });
});
