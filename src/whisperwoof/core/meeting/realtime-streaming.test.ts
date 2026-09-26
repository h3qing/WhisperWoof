/**
 * OpenAIRealtimeStreaming (helpers/openaiRealtimeStreaming.js) over a fake
 * OpenAI socket: when a session counts as live (connectedAt, which meeting
 * rotation goes by), and what disconnect() hands back.
 *
 * disconnect() used to throw when OpenAI closed the socket while it waited
 * for the final commit, and meeting stop (like dictation stop) replaced the
 * throw with an empty transcript, losing the whole session's text.
 */
import { createRequire } from "module";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { COMMIT_TRANSCRIPT, FakeWebSocket, injectModule, sockets } from "./fake-realtime-socket";

const require = createRequire(import.meta.url);
injectModule("ws", FakeWebSocket);
const OpenAIRealtimeStreaming = require("../../../helpers/openaiRealtimeStreaming");

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function sessionWithText(text: string) {
  const stream = new OpenAIRealtimeStreaming();
  await stream.connect({ apiKey: "ek_test", preconfigured: true });
  sockets.at(-1)!.transcribes(text);
  expect(stream.sendAudio(Buffer.alloc(4800))).toBe(true); // audio left to commit
  return { stream, socket: sockets.at(-1)! };
}

beforeEach(() => {
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAIRealtimeStreaming.connectedAt", () => {
  it.each([
    ["a server-configured (cloud) session once it is created", true],
    ["a self-configured (BYOK) session once its configuration is accepted", false],
  ])("is stamped for %s", async (_label, preconfigured) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
    const stream = new OpenAIRealtimeStreaming();
    expect(stream.connectedAt).toBeNull();

    const connecting = stream.connect({ apiKey: "ek_test", preconfigured });
    vi.setSystemTime(new Date("2026-09-25T10:00:02Z"));
    await connecting;

    expect(stream.connectedAt).toBe(Date.parse("2026-09-25T10:00:02Z"));
    const configured = sockets[0].sent.some((m) => m.type === "transcription_session.update");
    expect(configured).toBe(!preconfigured);
  });
});

describe("OpenAIRealtimeStreaming.disconnect", () => {
  it("returns the text right away when the server closes the socket during the final commit", async () => {
    const { stream, socket } = await sessionWithText("everything said so far");
    socket.onCommit = "drop";

    const started = Date.now();
    await expect(stream.disconnect()).resolves.toEqual({ text: "everything said so far" });
    expect(Date.now() - started).toBeLessThan(1000); // the close ends the 3s commit wait
    expect(stream.isConnected).toBe(false);
    expect(stream.isDisconnecting).toBe(false);
  });

  it("does not report the drop as an unexpected session end", async () => {
    const { stream, socket } = await sessionWithText("hello");
    socket.onCommit = "drop";
    stream.onSessionEnd = vi.fn();

    await stream.disconnect();
    await flush();

    expect(stream.onSessionEnd).not.toHaveBeenCalled();
  });

  it("still includes the committed last words when the server answers", async () => {
    const { stream, socket } = await sessionWithText("first part");

    await expect(stream.disconnect()).resolves.toEqual({
      text: `first part ${COMMIT_TRANSCRIPT}`,
    });
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("passes the last words on with when they were spoken", async () => {
    const { stream, socket } = await sessionWithText("first part");
    const onFinal = vi.fn();
    stream.onFinalTranscript = onFinal;
    const spokenAt = Date.now();
    socket.serverSends({ type: "input_audio_buffer.speech_started" });

    await stream.disconnect();

    expect(onFinal).toHaveBeenCalledWith(`first part ${COMMIT_TRANSCRIPT}`, expect.any(Number));
    expect(onFinal.mock.calls[0][1]).toBeGreaterThanOrEqual(spokenAt);
  });
});
