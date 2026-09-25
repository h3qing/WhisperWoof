/**
 * OpenAIRealtimeStreaming.disconnect() must hand back the session's text even
 * when OpenAI closes the socket while it waits for the final commit. It used
 * to throw there, and meeting stop (like dictation stop) replaced the throw
 * with an empty transcript, losing the whole session's text.
 */
import { createRequire } from "module";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeWebSocket, injectModule, sockets } from "./fake-realtime-socket";

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

describe("OpenAIRealtimeStreaming.disconnect", () => {
  beforeEach(() => {
    sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the text when the server closes the socket during the final commit", async () => {
    const { stream, socket } = await sessionWithText("everything said so far");
    socket.onCommit = "drop";
    vi.useFakeTimers({ toFake: ["setTimeout"] });

    const result = stream.disconnect();
    await flush(); // the server drops the socket instead of answering the commit
    await vi.advanceTimersByTimeAsync(3000); // commit wait times out

    await expect(result).resolves.toEqual({ text: "everything said so far" });
    expect(stream.isConnected).toBe(false);
    expect(stream.isDisconnecting).toBe(false);
  });

  it("does not report the drop as an unexpected session end", async () => {
    const { stream, socket } = await sessionWithText("hello");
    socket.onCommit = "drop";
    stream.onSessionEnd = vi.fn();
    vi.useFakeTimers({ toFake: ["setTimeout"] });

    const result = stream.disconnect();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    await result;

    expect(stream.onSessionEnd).not.toHaveBeenCalled();
  });

  it("still includes the committed last words when the server answers", async () => {
    const { stream, socket } = await sessionWithText("first part");

    await expect(stream.disconnect()).resolves.toEqual({
      text: "first part last words before rotation",
    });
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
