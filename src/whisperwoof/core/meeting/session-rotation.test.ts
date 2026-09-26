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
  SESSION_HARD_MAX_AGE_MS,
  sourcesToRotate,
  reconnectsRightAway,
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
  const session = (connectedAt: number | null) => ({
    connectedAt,
    isConnected: connectedAt != null,
    isConnecting: connectedAt == null,
  });
  const gone = (connectedAt: number) => ({ connectedAt, isConnected: false, isConnecting: false });
  const due = {
    active: true,
    now: START + SESSION_MAX_AGE_MS,
    rotating: false,
    streams: { mic: session(START), system: session(START) },
  };

  it("rotates from 25 minutes, and by 28 at the latest, before OpenAI's 30 minute limit", () => {
    expect(SESSION_MAX_AGE_MS).toBe(25 * MIN);
    expect(SESSION_HARD_MAX_AGE_MS).toBe(28 * MIN);
  });

  it("waits for a quiet moment instead of cutting a sentence in half, up to 28 minutes", () => {
    // speechStartedAt is set from speech start until that turn's transcript arrives.
    const midTurn = { ...session(START), speechStartedAt: START + SESSION_MAX_AGE_MS - 2000 };
    const streams = { mic: midTurn, system: session(START) };
    expect(sourcesToRotate({ ...due, streams })).toEqual(["system"]);
    expect(sourcesToRotate({ ...due, streams, now: START + 27 * MIN })).toEqual(["system"]);
    expect(sourcesToRotate({ ...due, streams, now: START + SESSION_HARD_MAX_AGE_MS })).toEqual([
      "mic",
      "system",
    ]);
  });

  it("leaves sessions younger than 25 minutes alone", () => {
    expect(sourcesToRotate({ ...due, now: START + SESSION_MAX_AGE_MS - 1 })).toEqual([]);
  });

  it("rotates every open stream once they reach 25 minutes", () => {
    expect(sourcesToRotate(due)).toEqual(["mic", "system"]);
    expect(sourcesToRotate({ ...due, now: START + 40 * MIN })).toEqual(["mic", "system"]);
  });

  it("goes by each session's own age, so a stream that reconnected later waits its turn", () => {
    const streams = { mic: session(START), system: session(START + 10 * MIN) };
    expect(sourcesToRotate({ ...due, streams })).toEqual(["mic"]);
    expect(sourcesToRotate({ ...due, streams, now: START + 35 * MIN })).toEqual(["mic", "system"]);
  });

  it("replaces a stream whose session is gone right away, whatever its age", () => {
    // Reconnect gave up (or never started): the 30s check keeps trying instead of
    // waiting until the dead session would have turned 25 minutes old.
    const streams = { mic: gone(START + 20 * MIN), system: session(START + 20 * MIN) };
    expect(sourcesToRotate({ ...due, streams })).toEqual(["mic"]);
    expect(sourcesToRotate({ ...due, streams, reconnecting: { mic: true } })).toEqual([]);
  });

  it("leaves a session that hasn't connected yet alone", () => {
    expect(sourcesToRotate({ ...due, streams: { mic: session(null), system: null } })).toEqual([]);
  });

  it("rotates only the mic when there is no system-audio stream", () => {
    expect(sourcesToRotate({ ...due, streams: { mic: session(START), system: null } })).toEqual([
      "mic",
    ]);
  });

  it("skips a stream that is mid-reconnect, since that opens a fresh session anyway", () => {
    expect(sourcesToRotate({ ...due, reconnecting: { mic: true } })).toEqual(["system"]);
    expect(sourcesToRotate({ ...due, reconnecting: { mic: true, system: true } })).toEqual([]);
  });

  it("does nothing while a rotation is already under way", () => {
    expect(sourcesToRotate({ ...due, rotating: true })).toEqual([]);
  });

  it("does nothing when no meeting is streaming", () => {
    expect(sourcesToRotate({ ...due, active: false })).toEqual([]);
    expect(sourcesToRotate({ ...due, streams: { mic: null, system: null } })).toEqual([]);
  });
});

describe("reconnectsRightAway", () => {
  it("reconnects a session that had been up for a minute or more", () => {
    expect(reconnectsRightAway({ connectedAt: START }, START + MIN)).toBe(true);
    expect(reconnectsRightAway({ connectedAt: START }, START + 40 * MIN)).toBe(true);
  });

  it("leaves one that dropped within a minute to the 30s check, so a flapping server can't loop", () => {
    expect(reconnectsRightAway({ connectedAt: START }, START + MIN - 1)).toBe(false);
    expect(reconnectsRightAway({ connectedAt: null }, START)).toBe(false);
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

  it("opens no sessions when the meeting ended during the token request", async () => {
    const { deps, created } = setup({ current: () => false });

    await expect(rotateMeetingStreams(deps)).resolves.toEqual({ rotated: false });

    expect(created).toEqual([]);
    expect(deps.swapIn).not.toHaveBeenCalled();
  });

  it("closes the new sessions without swapping when the meeting ended while they connected", async () => {
    let checks = 0;
    const { deps, created } = setup({ current: () => checks++ === 0 }); // ends after the tokens

    await expect(rotateMeetingStreams(deps)).resolves.toEqual({ rotated: false });

    expect(deps.swapIn).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);
    expect(created.every((s) => s.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("treats a new session that dropped before the swap as a failed rotation", async () => {
    const { deps, live, created } = setup();
    const before = { ...live };
    deps.createStreaming = ((create) => () => {
      const stream = create();
      if (stream.name === "new-system") {
        const connect = stream.connect;
        stream.connect = vi.fn(async () => {
          await connect();
          stream.isConnected = false; // dropped after connecting, before handlers were on
        });
      }
      return stream;
    })(deps.createStreaming);

    const result = await rotateMeetingStreams(deps);

    expect(result.rotated).toBe(false);
    expect(result.error?.message).toMatch(/closed before/);
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
