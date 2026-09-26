/**
 * Regression: meeting transcription stopped at minute 25. Rotation closed the
 * OpenAI Realtime sessions and waited for onSessionEnd to reconnect, but
 * disconnect() never fires it, so every later chunk went nowhere.
 *
 * These run the real IPCHandlers rotation/reconnect methods and the real
 * OpenAIRealtimeStreaming over a fake WebSocket. IPCHandlers can't be
 * constructed here, so each test builds an instance from the prototype with
 * only the fields these methods use; electron and ws are swapped in through
 * require.cache because the modules are CommonJS.
 */
import { createRequire } from "module";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeWebSocket, injectModule, sockets } from "./fake-realtime-socket";

const require = createRequire(import.meta.url);

const sentToWindow: Array<[string, unknown]> = [];
const win = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => sentToWindow.push([channel, payload]),
  },
};
injectModule("ws", FakeWebSocket);
injectModule("electron", {
  BrowserWindow: { fromWebContents: () => win, getAllWindows: () => [win] },
});
const IPCHandlers = require("../../../helpers/ipcHandlers");
const OpenAIRealtimeStreaming = require("../../../helpers/openaiRealtimeStreaming");

const MIN = 60 * 1000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Walk the reconnect backoff (fake setTimeout), letting the fake sockets answer between steps. */
async function runBackoff(reconnect: Promise<void>) {
  let done = false;
  reconnect.finally(() => (done = true));
  for (let t = 0; t < 31_000 && !done; t += 500) {
    await vi.advanceTimersByTimeAsync(500);
    await flush();
  }
  return reconnect;
}

async function liveStream(apiKey: string, { ageMinutes = 0 } = {}) {
  const stream = new OpenAIRealtimeStreaming();
  await stream.connect({ apiKey, preconfigured: true });
  stream.connectedAt = Date.now() - ageMinutes * MIN;
  return stream;
}

describe("meeting session rotation (IPCHandlers)", () => {
  let handlers: any;
  let fetchToken: ReturnType<typeof vi.fn>;
  let tokenCount: number;

  beforeEach(() => {
    sockets.length = 0;
    sentToWindow.length = 0;
    tokenCount = 0;
    fetchToken = vi.fn(async (_event: unknown, _options: unknown, { streams = 1 } = {}) => {
      const secrets = Array.from({ length: streams }, () => `ek_fresh_${++tokenCount}`);
      return streams === 2 ? secrets : secrets[0];
    });

    handlers = Object.create(IPCHandlers.prototype);
    handlers.environmentManager = { getOpenAIKey: vi.fn(() => "") }; // cloud user: no own key
    handlers._meetingTranscriptCheckpoint = { forceCheckpoint: vi.fn(), isActive: false };
    handlers._meetingAudioBuffer = { isActive: true };
    handlers._meetingMicStreaming = null;
    handlers._meetingSystemStreaming = null;
    handlers._meetingRetiredStreams = { mic: [], system: [] };
    handlers._meetingReconnecting = {};
    handlers._meetingStreamingGeneration = 0;
    handlers._fetchMeetingRealtimeToken = fetchToken;
    handlers._attachMeetingStreamingHandlers = vi.fn();
    handlers._startMeetingSessionRotation(
      { sender: {} },
      { mode: "cloud", model: "gpt-4o-mini-transcribe" }
    );
  });

  afterEach(() => {
    handlers._stopMeetingSessionRotation();
    vi.useRealTimers();
  });

  it("keeps transcribing after the 25 minute rotation", async () => {
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 26 });
    const oldSystem = await liveStream("ek_first_system", { ageMinutes: 26 });
    handlers._meetingMicStreaming = oldMic;
    handlers._meetingSystemStreaming = oldSystem;
    expect(oldMic.sendAudio(Buffer.alloc(4800))).toBe(true);

    await handlers._checkMeetingSessionRotation();
    await flush();

    const mic = handlers._meetingMicStreaming;
    const system = handlers._meetingSystemStreaming;
    expect(mic).not.toBe(oldMic);
    expect(system).not.toBe(oldSystem);
    expect(mic.isConnected && system.isConnected).toBe(true);
    expect(mic.sendAudio(Buffer.alloc(4800))).toBe(true);
    expect(system.sendAudio(Buffer.alloc(4800))).toBe(true);

    // Fresh cloud tokens for both streams, one request.
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(fetchToken.mock.calls[0][2]).toEqual({ streams: 2 });
    expect(sockets.slice(-2).map((s) => s.bearer)).toEqual(["ek_fresh_1", "ek_fresh_2"]);
    expect(handlers._attachMeetingStreamingHandlers).toHaveBeenCalledWith(mic, win, "mic");
    expect(handlers._attachMeetingStreamingHandlers).toHaveBeenCalledWith(system, win, "system");

    // The old sessions were committed and closed, and their text is kept.
    expect(oldMic.isConnected).toBe(false);
    expect(sockets[0].sent.map((m) => m.type)).toContain("input_audio_buffer.commit");
    expect(handlers._meetingRetiredStreams.mic).toEqual([oldMic]);
    expect(oldMic.getFullTranscript()).toBe("last words before rotation");

    // The renderer isn't told about an "error", and the fresh sessions aren't due again.
    expect(sentToWindow).toEqual([]);
    await handlers._checkMeetingSessionRotation();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("does nothing before 25 minutes", async () => {
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 24 });
    handlers._meetingMicStreaming = oldMic;

    await handlers._checkMeetingSessionRotation();

    expect(handlers._meetingMicStreaming).toBe(oldMic);
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("rotates sessions warmed up before recording by their own age, not the recording's", async () => {
    // Meeting mode pre-warms the sessions; recording started 1 minute ago, 25 minutes later.
    const warmMic = await liveStream("ek_warm_mic", { ageMinutes: 26 });
    handlers._meetingMicStreaming = warmMic;
    handlers._meetingStreamingStartedAt = Date.now() - 1 * MIN;

    await handlers._checkMeetingSessionRotation();

    expect(handlers._meetingMicStreaming).not.toBe(warmMic);
    expect(handlers._meetingMicStreaming.isConnected).toBe(true);
  });

  it("rotates only the stream that is due", async () => {
    // The system stream reconnected 5 minutes ago; the mic session is 26 minutes old.
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 26 });
    const reconnectedSystem = await liveStream("ek_reconnected_system", { ageMinutes: 5 });
    handlers._meetingMicStreaming = oldMic;
    handlers._meetingSystemStreaming = reconnectedSystem;

    await handlers._checkMeetingSessionRotation();

    expect(handlers._meetingMicStreaming).not.toBe(oldMic);
    expect(handlers._meetingSystemStreaming).toBe(reconnectedSystem);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(fetchToken.mock.calls[0]).toHaveLength(2); // one single-stream token
  });

  it("keeps the old session and retries on the next check when rotation fails", async () => {
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 26 });
    handlers._meetingMicStreaming = oldMic;
    fetchToken.mockRejectedValueOnce(new Error("Token request failed: 503"));

    await handlers._checkMeetingSessionRotation();

    expect(handlers._meetingMicStreaming).toBe(oldMic);
    expect(oldMic.sendAudio(Buffer.alloc(4800))).toBe(true);

    await handlers._checkMeetingSessionRotation();
    expect(handlers._meetingMicStreaming).not.toBe(oldMic);
  });

  it("closes the new session and leaves the stream alone when the meeting stops mid-rotation", async () => {
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 26 });
    handlers._meetingMicStreaming = oldMic;
    fetchToken.mockImplementationOnce(async () => {
      handlers._stopMeetingSessionRotation(); // meeting-transcription-stop
      return "ek_fresh_late";
    });

    await handlers._checkMeetingSessionRotation();
    await flush();

    expect(handlers._meetingMicStreaming).toBe(oldMic);
    const late = sockets.find((s) => s.bearer === "ek_fresh_late");
    expect(late?.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("reconnects a dropped cloud stream with a fresh cloud token, not the user's own key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const deadMic = await liveStream("ek_first_mic");
    handlers._meetingMicStreaming = deadMic;
    sockets[0].drop();

    await runBackoff(handlers._attemptMeetingReconnect("mic", win, deadMic));

    const mic = handlers._meetingMicStreaming;
    expect(mic).not.toBe(deadMic);
    expect(mic.isConnected).toBe(true);
    expect(mic.sendAudio(Buffer.alloc(4800))).toBe(true);
    expect(fetchToken).toHaveBeenCalledWith(
      { sender: {} },
      expect.objectContaining({ mode: "cloud" })
    );
    expect(sockets.at(-1)!.bearer).toBe("ek_fresh_1");
    expect(handlers.environmentManager.getOpenAIKey).not.toHaveBeenCalled();
    expect(handlers._meetingRetiredStreams.mic).toEqual([deadMic]);
    expect(handlers._meetingReconnecting.mic).toBe(false);
  });

  it("drops a reconnect that finishes after the meeting stopped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const deadMic = await liveStream("ek_first_mic");
    handlers._meetingMicStreaming = deadMic;
    fetchToken.mockImplementationOnce(async () => {
      handlers._stopMeetingSessionRotation();
      return "ek_fresh_late";
    });

    await runBackoff(handlers._attemptMeetingReconnect("mic", win, deadMic));
    await flush();

    expect(handlers._meetingMicStreaming).toBe(deadMic);
    expect(sockets.find((s) => s.bearer === "ek_fresh_late")?.readyState).toBe(
      FakeWebSocket.CLOSED
    );
  });

  it("stands a reconnect down when rotation already replaced the stream that dropped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const oldMic = await liveStream("ek_first_mic", { ageMinutes: 26 });
    handlers._meetingMicStreaming = oldMic;

    // Rotation starts, then the old mic session drops before the swap.
    const rotation = handlers._checkMeetingSessionRotation();
    sockets[0].drop();
    const reconnect = handlers._attemptMeetingReconnect("mic", win, oldMic);
    await rotation;
    const rotatedMic = handlers._meetingMicStreaming;
    expect(rotatedMic).not.toBe(oldMic);

    await runBackoff(reconnect);

    expect(handlers._meetingMicStreaming).toBe(rotatedMic);
    expect(rotatedMic.isConnected).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(1); // rotation's token only
    expect(handlers._meetingReconnecting.mic).toBe(false);
    expect(sentToWindow).toEqual([]);
  });

  it("leaves the next meeting's reconnect state alone when an old reconnect gives up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const deadMic = await liveStream("ek_first_mic");
    handlers._meetingMicStreaming = deadMic;
    sockets[0].drop();
    fetchToken.mockRejectedValueOnce(new Error("Token request failed: 503"));
    fetchToken.mockRejectedValueOnce(new Error("Token request failed: 503"));
    fetchToken.mockRejectedValueOnce(new Error("Token request failed: 503"));
    fetchToken.mockRejectedValueOnce(new Error("Token request failed: 503"));
    fetchToken.mockImplementationOnce(async () => {
      // The meeting ends and a new one starts during the last attempt.
      handlers._stopMeetingSessionRotation();
      handlers._startMeetingSessionRotation({ sender: {} }, { mode: "cloud" });
      handlers._meetingReconnecting = { mic: true }; // the new meeting's own reconnect
      throw new Error("Token request failed: 503");
    });

    await runBackoff(handlers._attemptMeetingReconnect("mic", win, deadMic));

    expect(fetchToken).toHaveBeenCalledTimes(5);
    expect(handlers._meetingReconnecting).toEqual({ mic: true });
    expect(sentToWindow).toEqual([]);
  });
});
