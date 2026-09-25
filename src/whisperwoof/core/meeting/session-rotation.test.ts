/**
 * Meeting session rotation (helpers/meetingSessionRotation.js): when a long
 * meeting's OpenAI Realtime sessions are due for replacement, and how the
 * fresh ones take over without dropping audio.
 */
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  SESSION_MAX_AGE_MS,
  sourcesToRotate,
  meetingConnectOptions,
  rotateMeetingStreams,
  meetingTranscriptText,
} = require("../../../helpers/meetingSessionRotation");

const MIN = 60 * 1000;
const START = 1_000_000;

function fakeStream(name: string, log: string[], { failConnect = false, text = "" } = {}) {
  const stream = {
    name,
    isConnected: false,
    connect: vi.fn(async () => {
      log.push(`connect ${name}`);
      if (failConnect) throw new Error(`${name} refused`);
      stream.isConnected = true;
    }),
    disconnect: vi.fn(async () => {
      log.push(`disconnect ${name}`);
      stream.isConnected = false;
      return { text };
    }),
    getFullTranscript: () => text,
  };
  return stream;
}

describe("sourcesToRotate", () => {
  const streams = { mic: {}, system: {} };
  const due = { startedAt: START, now: START + SESSION_MAX_AGE_MS, rotating: false, streams };

  it("rotates 5 minutes before OpenAI's 30 minute session limit", () => {
    expect(SESSION_MAX_AGE_MS).toBe(25 * MIN);
  });

  it("leaves sessions younger than 25 minutes alone", () => {
    expect(sourcesToRotate({ ...due, now: START + SESSION_MAX_AGE_MS - 1 })).toEqual([]);
  });

  it("rotates every open stream once they reach 25 minutes", () => {
    expect(sourcesToRotate(due)).toEqual(["mic", "system"]);
    expect(sourcesToRotate({ ...due, now: START + 40 * MIN })).toEqual(["mic", "system"]);
  });

  it("rotates only the mic when there is no system-audio stream", () => {
    expect(sourcesToRotate({ ...due, streams: { mic: {}, system: null } })).toEqual(["mic"]);
  });

  it("skips a stream that is mid-reconnect, since that opens a fresh session anyway", () => {
    expect(sourcesToRotate({ ...due, reconnecting: { mic: true } })).toEqual(["system"]);
    expect(sourcesToRotate({ ...due, reconnecting: { mic: true, system: true } })).toEqual([]);
  });

  it("does nothing while a rotation is already under way", () => {
    expect(sourcesToRotate({ ...due, rotating: true })).toEqual([]);
  });

  it("does nothing when no meeting is streaming", () => {
    expect(sourcesToRotate({ ...due, startedAt: null })).toEqual([]);
    expect(sourcesToRotate({ ...due, streams: { mic: null, system: null } })).toEqual([]);
  });
});

describe("meetingConnectOptions", () => {
  it("uses server-configured sessions for cloud tokens and self-configured ones for BYOK", () => {
    expect(
      meetingConnectOptions({ mode: "cloud", model: "gpt-4o-transcribe", language: "en" })
    ).toEqual({
      model: "gpt-4o-transcribe",
      language: "en",
      preconfigured: true,
    });
    expect(meetingConnectOptions({ mode: "byok", model: "gpt-4o-mini-transcribe" })).toMatchObject({
      preconfigured: false,
    });
  });
});

describe("rotateMeetingStreams", () => {
  function setup({
    sources = ["mic", "system"],
    fail = [] as string[],
    current = (): boolean => true,
  } = {}) {
    const log: string[] = [];
    const live: Record<string, ReturnType<typeof fakeStream>> = {
      mic: fakeStream("old-mic", log),
      system: fakeStream("old-system", log),
    };
    live.mic.isConnected = true;
    live.system.isConnected = true;
    const created: ReturnType<typeof fakeStream>[] = [];
    let n = 0;
    const deps = {
      sources,
      fetchTokens: vi.fn(async (count: number) => {
        log.push(`tokens ${count}`);
        return Array.from({ length: count }, (_, i) => `secret-${i}`);
      }),
      createStreaming: () => {
        const source = sources[n++];
        const stream = fakeStream(`new-${source}`, log, { failConnect: fail.includes(source) });
        created.push(stream);
        return stream;
      },
      attachHandlers: vi.fn((stream: { name: string }, source: string) =>
        log.push(`attach ${stream.name} ${source}`)
      ),
      connectOptions: { model: "gpt-4o-mini-transcribe", preconfigured: true },
      isCurrent: vi.fn(current),
      swapIn: vi.fn((source: string, stream: ReturnType<typeof fakeStream>) => {
        log.push(`swap ${source}`);
        const replaced = live[source];
        live[source] = stream;
        return replaced;
      }),
    };
    return { deps, log, live, created };
  }

  it("connects the new sessions before swapping them in, and closes the old ones last", async () => {
    const { deps, log, live, created } = setup();

    await expect(rotateMeetingStreams(deps)).resolves.toEqual({ rotated: true });

    expect(log).toEqual([
      "tokens 2",
      "connect new-mic",
      "connect new-system",
      "attach new-mic mic",
      "swap mic",
      "attach new-system system",
      "swap system",
      "disconnect old-mic",
      "disconnect old-system",
    ]);
    expect(live.mic).toBe(created[0]);
    expect(live.system).toBe(created[1]);
    expect(live.mic.isConnected).toBe(true);
  });

  it("gives each new session its own fresh token", async () => {
    const { deps, created } = setup();
    await rotateMeetingStreams(deps);
    expect(created[0].connect).toHaveBeenCalledWith({ apiKey: "secret-0", ...deps.connectOptions });
    expect(created[1].connect).toHaveBeenCalledWith({ apiKey: "secret-1", ...deps.connectOptions });
  });

  it("keeps audio on the old sessions until every new one is live", async () => {
    const { deps, live, created } = setup();
    const oldMic = live.mic;
    let releaseSystem = () => {};
    const systemReady = new Promise<void>((resolve) => (releaseSystem = resolve));
    deps.createStreaming = ((create) => () => {
      const stream = create();
      if (stream.name === "new-system") {
        const connect = stream.connect;
        stream.connect = vi.fn(async () => {
          await systemReady;
          return connect();
        });
      }
      return stream;
    })(deps.createStreaming);

    const rotation = rotateMeetingStreams(deps);
    await new Promise((resolve) => setImmediate(resolve));

    expect(created[0].isConnected).toBe(true); // the new mic is live...
    expect(live.mic).toBe(oldMic); // ...but audio stays on the old one until system is too
    expect(deps.swapIn).not.toHaveBeenCalled();

    releaseSystem();
    await rotation;
    expect(live.mic).toBe(created[0]);
  });

  it("keeps the old sessions when a new one fails to connect, and closes the ones that did", async () => {
    const { deps, log, live, created } = setup({ fail: ["system"] });
    const before = { ...live };

    const result = await rotateMeetingStreams(deps);

    expect(result.rotated).toBe(false);
    expect(result.error.message).toBe("new-system refused");
    expect(live).toEqual(before);
    expect(deps.swapIn).not.toHaveBeenCalled();
    expect(deps.attachHandlers).not.toHaveBeenCalled();
    expect(created[0].disconnect).toHaveBeenCalled();
    expect(log).not.toContain("disconnect old-mic");
  });

  it("keeps the old sessions when the token request fails", async () => {
    const { deps, live } = setup();
    const before = { ...live };
    deps.fetchTokens = vi.fn(async () => {
      throw new Error("Token request failed: 503");
    });

    const result = await rotateMeetingStreams(deps);

    expect(result).toMatchObject({ rotated: false, error: new Error("Token request failed: 503") });
    expect(live).toEqual(before);
  });

  it("closes the new sessions without swapping when the meeting ended meanwhile", async () => {
    const { deps, created } = setup({ current: () => false });

    await expect(rotateMeetingStreams(deps)).resolves.toEqual({ rotated: false });

    expect(deps.swapIn).not.toHaveBeenCalled();
    expect(created.every((s) => s.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("treats a new session that dropped before the swap as a failed rotation", async () => {
    const { deps, live, created } = setup();
    const before = { ...live };
    deps.isCurrent = vi.fn(() => {
      created[1].isConnected = false; // dropped after connecting, before handlers were on
      return true;
    });

    const result = await rotateMeetingStreams(deps);

    expect(result.rotated).toBe(false);
    expect(live).toEqual(before);
    expect(created[0].disconnect).toHaveBeenCalled();
  });

  it("rotates a single stream with a single token", async () => {
    const { deps, live, created } = setup({ sources: ["mic"] });
    await rotateMeetingStreams(deps);
    expect(deps.fetchTokens).toHaveBeenCalledWith(1);
    expect(live.mic).toBe(created[0]);
    expect(live.system.name).toBe("old-system");
  });
});

describe("meetingTranscriptText", () => {
  const session = (text: string) => ({ getFullTranscript: () => text });

  it("puts each source's rotated-out sessions before the one open at the end", () => {
    const retired = {
      mic: [session("mic 0-25"), session("mic 25-50")],
      system: [session("sys 0-25")],
    };
    const results = [{ text: "mic 50-60" }, { text: "sys 25-60" }];
    expect(meetingTranscriptText(retired, results)).toBe(
      "mic 0-25 mic 25-50 mic 50-60 sys 0-25 sys 25-60"
    );
  });

  it("matches the old mic-then-system text when nothing was rotated", () => {
    const retired = { mic: [], system: [] };
    expect(meetingTranscriptText(retired, [{ text: "hello" }, { text: "" }])).toBe("hello");
    expect(meetingTranscriptText(retired, [{ text: "" }, { text: "" }])).toBe("");
  });
});
