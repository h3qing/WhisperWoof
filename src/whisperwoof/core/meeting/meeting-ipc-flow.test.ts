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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
const { MeetingLocalSession } = require("../../../helpers/meetingLocalSession");

/** The local model's server: one sentence per piece of audio. */
function fakeModelServer() {
  let n = 0;
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    transcribe: vi.fn(async () => {
      const text = `line ${++n}.`;
      return { text, detail: { text, tokens: ["▁line", "."], timestamps: [0.2, 0.4] } };
    }),
  };
}

function localSession({ downloaded }: { downloaded: boolean }) {
  const server = fakeModelServer();
  const saveTranscript = vi.fn((_noteId: number, _transcript: string) => true);
  const session = new MeetingLocalSession({
    parakeetManager: {
      getModelsDir: () => "/models",
      serverManager: { isAvailable: () => true, isModelDownloaded: () => downloaded },
    },
    createServer: () => server,
    saveTranscript,
  });
  return { session, server, saveTranscript };
}

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
    handlers._meetingLocalSession = localSession({ downloaded: false }).session;
    handlers._meetingAudioBuffer = {
      isActive: false,
      startedWith: null,
      start(options: unknown) {
        this.isActive = true;
        this.startedWith = options;
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
      start: vi.fn(),
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

  it("keeps the meeting's audio when its window closes, since nothing saves the transcript then", async () => {
    handlers._meetingAudioBuffer.stop = function () {
      this.isActive = false;
      return { dir: "/tmp/meeting-audio-2", files: ["/tmp/meeting-audio-2/mic-0000.wav"] };
    };
    handlers._meetingAudioBuffer.cleanupFiles = vi.fn();
    const first = await startMeeting();
    speak();
    first.transcribes("forty minutes in");

    sender.emit("render-process-gone");
    await vi.waitFor(() => expect(handlers._meetingAudioBuffer.isActive).toBe(false));

    expect(handlers._meetingAudioBuffer.cleanupFiles).not.toHaveBeenCalled();
  });

  it("undoes a start with a provider it doesn't know, so the next meeting can start", async () => {
    const odd = await ipc.get("meeting-transcription-start")!(event, { provider: "other" });
    expect(odd).toMatchObject({ success: false, error: "Unsupported provider: other" });
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
    expect(sender.listenerCount("destroyed")).toBe(0);
    await startMeeting();
    await ipc.get("meeting-transcription-stop")!();
  });

  it("drops a start whose window is gone by the time its turn comes", async () => {
    const gone = Object.assign(new EventEmitter(), { isDestroyed: () => true });
    const result = await ipc.get("meeting-transcription-start")!(
      { sender: gone },
      {
        provider: "openai-realtime",
        mode: "byok",
      }
    );
    expect(result).toMatchObject({ success: false });
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
    expect(sockets).toHaveLength(0);
  });

  it("doesn't start the transcript checkpoint, which would write over the note's own text", async () => {
    await ipc.get("meeting-transcription-start")!(event, {
      provider: "openai-realtime",
      mode: "byok",
      noteId: 7,
    });
    expect(handlers._meetingTranscriptCheckpoint.start).not.toHaveBeenCalled();
    await ipc.get("meeting-transcription-stop")!();
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

describe("a meeting transcribed on this Mac, through the IPC handlers", () => {
  let handlers: any;
  let local: ReturnType<typeof localSession>;

  beforeEach(() => {
    sender.removeAllListeners();
    ipc.clear();
    sent.length = 0;
    sockets.length = 0;
    handlers = Object.create(IPCHandlers.prototype);
    local = localSession({ downloaded: true });
    handlers._meetingLocalSession = local.session;
    handlers._meetingAudioBuffer = {
      isActive: false,
      startedWith: null,
      start(options: unknown) {
        this.isActive = true;
        this.startedWith = options;
      },
      stop() {
        this.isActive = false;
        return { dir: "/tmp/meeting-audio-1", files: ["/tmp/meeting-audio-1/mic-0000.wav"] };
      },
      writeChunk: vi.fn(),
      cleanupFiles: vi.fn(),
      getSessionDir: () => null,
    };
    handlers._meetingTranscriptCheckpoint = {
      isActive: false,
      forceCheckpoint() {},
      stop: () => ({ savedSegments: 0, persisted: true }),
    };
    handlers._meetingReconnecting = {};
    handlers._meetingRetiredStreams = { mic: [], system: [] };
    handlers.setupHandlers();
  });

  /** 3 s of tone, in the 100 ms chunks the window sends. */
  const speak = () => {
    const pcm = Buffer.alloc(3 * 16000 * 2);
    for (let i = 0; i < pcm.length / 2; i++) {
      pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / 16000)), i * 2);
    }
    for (let i = 0; i < pcm.length; i += 3200) {
      ipc.get("meeting-transcription-send")!(event, pcm.subarray(i, i + 3200), "mic");
    }
  };

  it("needs no warm-up and opens no cloud connection", async () => {
    const prepared = await ipc.get("meeting-transcription-prepare")!(event, {
      provider: "openai-realtime",
    });
    expect(prepared).toMatchObject({ success: true });
    expect(sockets).toHaveLength(0);
  });

  it("records at 16 kHz, and stop returns every line, saved to the meeting's note", async () => {
    const started = await ipc.get("meeting-transcription-start")!(event, {
      provider: "openai-realtime",
      noteId: 7,
    });
    expect(started).toMatchObject({ success: true, local: true, sampleRate: 16000 });
    expect(handlers._meetingAudioBuffer.startedWith).toEqual({ sampleRate: 16000 });
    expect(sockets).toHaveLength(0);

    speak();
    const stopped: any = await ipc.get("meeting-transcription-stop")!();

    expect(stopped).toMatchObject({ success: true, transcript: "line 1." });
    expect(stopped.segments).toEqual([
      expect.objectContaining({ text: "line 1.", source: "mic", type: "final" }),
    ]);
    expect(finals()).toEqual(["line 1."]);
    expect(local.saveTranscript).toHaveBeenLastCalledWith(7, expect.stringContaining("line 1."));
    expect(local.server.stop).toHaveBeenCalled();
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
  });

  it("finishes once when the window and the backstop both stop it", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    speak();

    const [a, b] = await Promise.all([
      ipc.get("meeting-transcription-stop")!(),
      ipc.get("meeting-transcription-stop")!(),
    ]);

    expect(a).toBe(b);
    expect(local.server.stop).toHaveBeenCalledTimes(1);
  });

  it("a stop while the model is still loading waits for it, then stops everything", async () => {
    let loaded = () => {};
    local.server.start.mockImplementationOnce(() => new Promise<void>((r) => (loaded = r)));

    const starting = ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    const stopping = ipc.get("meeting-transcription-stop")!();
    await flush();
    loaded();

    expect(await starting).toMatchObject({ success: true, local: true });
    expect(await stopping).toMatchObject({ success: true });
    expect(local.session.isActive).toBe(false);
    expect(local.server.stop).toHaveBeenCalled();
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("starts the next meeting once the last one has finished stopping, each in its own note", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    speak();

    const stoppingA = ipc.get("meeting-transcription-stop")!();
    const startingB = ipc.get("meeting-transcription-start")!(event, { noteId: 8 });
    expect(await stoppingA).toMatchObject({ transcript: "line 1." });
    expect(await startingB).toMatchObject({ success: true });

    speak();
    const stoppedB = await ipc.get("meeting-transcription-stop")!();

    expect(stoppedB).toMatchObject({ transcript: "line 2." });
    const saves = local.saveTranscript.mock.calls.map(([noteId, json]) => [
      noteId,
      JSON.parse(json)[0].text,
    ]);
    expect(saves.filter(([noteId]) => noteId === 7).every(([, text]) => text === "line 1.")).toBe(
      true
    );
    expect(saves.at(-1)).toEqual([8, "line 2."]);
  });

  it("refuses a second start while a meeting is recording, and keeps that meeting going", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    const again = await ipc.get("meeting-transcription-start")!(event, { noteId: 8 });
    expect(again).toMatchObject({ success: false });
    expect(local.session.isActive).toBe(true);
    speak();
    expect(await ipc.get("meeting-transcription-stop")!()).toMatchObject({ transcript: "line 1." });
  });

  /** macOS system audio: a native tap the tests drive by hand. */
  function fakeTap({ fails = false } = {}) {
    const tap = {
      onChunk: null as null | ((chunk: Buffer) => void),
      isSupported: () => true,
      start: vi.fn(async ({ onChunk }: { onChunk: (chunk: Buffer) => void }) => {
        if (fails) throw new Error("System audio permission denied");
        tap.onChunk = onChunk;
      }),
      stop: vi.fn(async () => {}),
    };
    return tap;
  }

  it("records system audio at 16 kHz too, as the other side of the meeting", async () => {
    const tap = fakeTap();
    handlers.audioTapManager = tap;
    const started = await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    expect(started).toMatchObject({ success: true, systemAudioMode: "native" });
    expect(tap.start).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 16000 }));

    const pcm = Buffer.alloc(3 * 16000 * 2);
    for (let i = 0; i < pcm.length / 2; i++) {
      pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / 16000)), i * 2);
    }
    for (let i = 0; i < pcm.length; i += 3200) tap.onChunk!(pcm.subarray(i, i + 3200));
    const stopped: any = await ipc.get("meeting-transcription-stop")!();

    expect(stopped.segments).toEqual([expect.objectContaining({ source: "system" })]);
    expect(tap.stop).toHaveBeenCalled();
  });

  it("stops the model again when system audio can't start, so the next meeting can", async () => {
    handlers.audioTapManager = fakeTap({ fails: true });
    const started = await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    expect(started).toMatchObject({ success: false, error: "System audio permission denied" });
    expect(local.session.isActive).toBe(false);
    expect(local.server.stop).toHaveBeenCalled();

    handlers.audioTapManager = fakeTap();
    const next = await ipc.get("meeting-transcription-start")!(event, { noteId: 8 });
    expect(next).toMatchObject({ success: true, local: true });
    await ipc.get("meeting-transcription-stop")!();
  });

  it("deletes the meeting's audio once the whole transcript is saved", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    speak();
    const stopped: any = await ipc.get("meeting-transcription-stop")!();
    expect(handlers._meetingAudioBuffer.cleanupFiles).toHaveBeenCalledWith("/tmp/meeting-audio-1");
    expect(stopped.audioBufferDir).toBeUndefined();
  });

  it("keeps the meeting's audio when part of it couldn't be transcribed", async () => {
    local.server.transcribe.mockRejectedValueOnce(new Error("server gone"));
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    speak();
    const stopped: any = await ipc.get("meeting-transcription-stop")!();
    expect(handlers._meetingAudioBuffer.cleanupFiles).not.toHaveBeenCalled();
    expect(stopped.audioBufferDir).toBe("/tmp/meeting-audio-1");
  });

  it("finishes and saves the meeting when the window that runs it closes", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    speak();

    sender.emit("destroyed");
    await vi.waitFor(() => expect(local.server.stop).toHaveBeenCalled());

    expect(local.saveTranscript).toHaveBeenLastCalledWith(7, expect.stringContaining("line 1."));
    expect(local.session.isActive).toBe(false);
  });

  it("ignores audio from a source other than the mic and system audio", async () => {
    await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    ipc.get("meeting-transcription-send")!(event, Buffer.alloc(3200), "../../escape");
    expect(handlers._meetingAudioBuffer.writeChunk).not.toHaveBeenCalled();
    await ipc.get("meeting-transcription-stop")!();
  });

  it("fails to start, leaving nothing running, when the model won't load", async () => {
    local.server.start.mockRejectedValueOnce(new Error("model missing"));
    const started = await ipc.get("meeting-transcription-start")!(event, { noteId: 7 });
    expect(started).toMatchObject({ success: false, error: "model missing" });
    expect(local.session.isActive).toBe(false);
    expect(handlers._meetingAudioBuffer.isActive).toBe(false);
    expect(sender.listenerCount("destroyed")).toBe(0);
  });
});
