/**
 * MeetingLocalSession (helpers/meetingLocalSession.js): a meeting transcribed
 * on this Mac. Starts SenseVoice in a server of its own, feeds it the meeting
 * clip by clip, and saves the transcript into the meeting's note as it goes.
 */
import { createRequire } from "module";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const {
  MeetingLocalSession,
  LOCAL_MEETING_MODEL,
} = require("../../../helpers/meetingLocalSession");

const SR = 16000;
const START = Date.parse("2026-09-27T10:00:00Z");

/** Speech-loud 16-bit PCM. */
function speech(seconds: number) {
  const buf = Buffer.alloc(seconds * SR * 2);
  for (let i = 0; i < seconds * SR; i++) {
    buf.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / SR)), i * 2);
  }
  return buf;
}

function feed(session: any, source: string, buf: Buffer) {
  for (let i = 0; i < buf.length; i += 3200) session.push(source, buf.subarray(i, i + 3200));
}

/** A sherpa-onnx offline server: replies with one sentence per request. */
function fakeServer() {
  let n = 0;
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    transcribe: vi.fn(async (bytes: Buffer, sampleRate: number) => {
      const seconds = bytes.length / 4 / sampleRate;
      const text = `第${++n}句。`;
      return {
        text,
        elapsed: 1,
        detail: { text, tokens: ["第", "句", "。"], timestamps: [0.5, 0.6, seconds - 0.1] },
      };
    }),
  };
}

function make({
  server = fakeServer(),
  saveTranscript = vi.fn((_noteId: number, _transcript: string) => true),
  downloaded = true,
  binary = true,
  clipTargetS = undefined as number | undefined,
} = {}) {
  const parakeetManager = {
    getModelsDir: () => "/models",
    serverManager: {
      isAvailable: (runtime: string) => binary && runtime === "offline",
      isModelDownloaded: (name: string) => downloaded && name === LOCAL_MEETING_MODEL,
    },
  };
  const session = new MeetingLocalSession({
    parakeetManager,
    createServer: () => server,
    saveTranscript,
    clipTargetS,
  });
  return { session, server, saveTranscript };
}

describe("MeetingLocalSession", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START + 100);
  });
  afterEach(() => vi.useRealTimers());

  it("is available once SenseVoice and the offline server are on this Mac", () => {
    expect(make().session.isAvailable()).toBe(true);
    expect(make({ downloaded: false }).session.isAvailable()).toBe(false);
    expect(make({ binary: false }).session.isAvailable()).toBe(false);
  });

  it("starts SenseVoice from the models folder, in a server of its own", async () => {
    const { session, server } = make();
    await session.start({ noteId: 7 });
    expect(server.start).toHaveBeenCalledWith(
      LOCAL_MEETING_MODEL,
      `/models/${LOCAL_MEETING_MODEL}`,
      "offline"
    );
    expect(session.isActive).toBe(true);
  });

  it("returns every line on stop, saves the transcript to the note and stops the model", async () => {
    const { session, server, saveTranscript } = make();
    const onLines = vi.fn();
    await session.start({ noteId: 7, onLines });
    feed(session, "mic", speech(5));
    feed(session, "system", speech(5));

    const result = await session.stop();

    expect(result.complete).toBe(true);
    expect(result.lines.map((l: { source: string }) => l.source).sort()).toEqual(["mic", "system"]);
    expect(result.transcript).toBe(result.lines.map((l: { text: string }) => l.text).join(""));
    expect(onLines).toHaveBeenCalled();
    const [noteId, saved] = saveTranscript.mock.calls.at(-1)!;
    expect(noteId).toBe(7);
    expect(JSON.parse(saved)).toEqual(
      result.lines.map(({ text, source, timestamp }: any) => ({ text, source, timestamp }))
    );
    expect(server.stop).toHaveBeenCalled();
    expect(session.isActive).toBe(false);
  });

  it("saves to the note as clips finish, before the meeting ends", async () => {
    const { session, saveTranscript } = make({ clipTargetS: 10 });
    await session.start({ noteId: 7 });
    feed(session, "mic", speech(35));
    await vi.waitFor(() => expect(saveTranscript).toHaveBeenCalled());
    expect(session.isActive).toBe(true);
    await session.stop();
  });

  it("doesn't touch the note when nothing was said", async () => {
    const { session, saveTranscript } = make();
    await session.start({ noteId: 7 });
    const result = await session.stop();
    expect(result).toMatchObject({ lines: [], complete: true });
    expect(saveTranscript).not.toHaveBeenCalled();
  });

  it("reports an incomplete transcript when a piece failed or the note wasn't saved", async () => {
    const failing = fakeServer();
    failing.transcribe.mockRejectedValueOnce(new Error("server gone"));
    const a = make({ server: failing });
    await a.session.start({ noteId: 7 });
    feed(a.session, "mic", speech(5));
    expect((await a.session.stop()).complete).toBe(false);

    const b = make({ saveTranscript: vi.fn((_noteId: number, _transcript: string) => false) });
    await b.session.start({ noteId: 7 });
    feed(b.session, "mic", speech(5));
    expect((await b.session.stop()).complete).toBe(false);
  });

  it("still returns the lines when there's no note to save them to", async () => {
    const { session, saveTranscript } = make();
    await session.start({ noteId: null });
    feed(session, "mic", speech(5));
    const result = await session.stop();
    expect(result.lines).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(saveTranscript).not.toHaveBeenCalled();
  });

  it("fails to start, and cleans up, when the model won't load", async () => {
    const server = fakeServer();
    server.start.mockRejectedValueOnce(new Error("model missing"));
    const { session } = make({ server });
    await expect(session.start({ noteId: 7 })).rejects.toThrow("model missing");
    expect(server.stop).toHaveBeenCalled();
    expect(session.isActive).toBe(false);
  });

  it("stops the model right away when the app quits", async () => {
    const { session, server } = make();
    await session.start({ noteId: 7 });
    feed(session, "mic", speech(5));
    await session.shutdown();
    expect(server.stop).toHaveBeenCalled();
    expect(session.isActive).toBe(false);
  });
});
