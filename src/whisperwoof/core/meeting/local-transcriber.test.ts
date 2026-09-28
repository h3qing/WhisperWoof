/**
 * MeetingLocalTranscriber (helpers/meetingLocalTranscriber.js): buffers each
 * track's audio, hands a clip to the local model once it reaches its target
 * length plus a lookahead (cut at the quietest moment in the lookahead), and
 * turns the model's replies into timed lines.
 */
import { createRequire } from "module";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const MeetingLocalTranscriber = require("../../../helpers/meetingLocalTranscriber");

const SR = 16000;
const START = Date.parse("2026-09-27T10:00:00Z");

/** 16-bit PCM: a loud tone, with quiet stretches at the given [from, to) seconds. */
function pcm(seconds: number, quiet: Array<[number, number]> = []) {
  const buf = Buffer.alloc(seconds * SR * 2);
  for (let i = 0; i < seconds * SR; i++) {
    const t = i / SR;
    const q = quiet.some(([a, b]) => t >= a && t < b);
    buf.writeInt16LE(q ? 0 : Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / SR)), i * 2);
  }
  return buf;
}

/** Feed a buffer in 100 ms chunks, like the tap and the mic worklet do. */
function feed(t: InstanceType<typeof MeetingLocalTranscriber>, source: string, buf: Buffer) {
  for (let i = 0; i < buf.length; i += 3200) t.push(source, buf.subarray(i, i + 3200));
}

/** A fake model: one sentence per piece, saying how long the piece was. */
function fakeModel() {
  const calls: Array<{ seconds: number }> = [];
  const transcribe = vi.fn(async (samples: Float32Array, sr: number) => {
    const seconds = samples.length / sr;
    calls.push({ seconds });
    return {
      text: `piece of ${seconds.toFixed(1)} s。`,
      tokens: ["p", "。"],
      timestamps: [0.5, seconds - 0.1],
    };
  });
  return { transcribe, calls };
}

function make(model = fakeModel(), onLines = vi.fn()) {
  const t = new MeetingLocalTranscriber({
    sampleRate: SR,
    clipTargetS: 120,
    lookaheadS: 20,
    transcribe: model.transcribe,
    onLines,
  });
  return { t, model, onLines };
}

describe("MeetingLocalTranscriber", () => {
  // The first 100 ms chunk arrives at START + 100 ms, so it began at START.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START + 100);
  });
  afterEach(() => vi.useRealTimers());

  it("waits until a track has its target length plus the lookahead, then cuts at the lull", async () => {
    const { t, model } = make();
    feed(t, "mic", pcm(139, [[131, 131.5]]));
    await t.idle();
    expect(model.transcribe).not.toHaveBeenCalled(); // 139 s < 120 + 20

    feed(t, "mic", pcm(2));
    await t.idle();
    const total = model.calls.reduce((s, c) => s + c.seconds, 0);
    expect(total).toBeGreaterThan(131);
    expect(total).toBeLessThan(131.5); // the first clip ends inside the quiet stretch
  });

  it("sends the model pieces of at most 20 s", async () => {
    const { t, model } = make();
    feed(t, "mic", pcm(141));
    await t.finish();
    expect(model.calls.length).toBeGreaterThan(6);
    model.calls.forEach((c) => expect(c.seconds).toBeLessThanOrEqual(20));
  });

  it("transcribes what is left when the meeting ends, and returns every line in time order", async () => {
    const { t, onLines } = make();
    feed(t, "mic", pcm(30));
    const lines = await t.finish();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l: { source: string }) => l.source === "mic")).toBe(true);
    expect(lines.map((l: { timestamp: number }) => l.timestamp)).toEqual(
      [...lines.map((l: { timestamp: number }) => l.timestamp)].sort((a, b) => a - b)
    );
    expect(onLines).toHaveBeenCalled();
  });

  it("dates each line from when its track began, the clip's place in the track and the token time", async () => {
    const { t } = make();
    feed(t, "mic", pcm(10));
    const [line] = await t.finish();
    expect(line).toMatchObject({ source: "mic", type: "final", text: "piece of 10.0 s。" });
    expect(line.timestamp).toBe(START + 500); // piece starts at 0 s, first token at 0.5 s
  });

  it("puts both tracks on one timeline, each from its own first chunk", async () => {
    const { t } = make();
    feed(t, "mic", pcm(8));
    vi.setSystemTime(START + 2100); // the system audio starts 2 s later
    feed(t, "system", pcm(8));
    const lines = await t.finish();
    expect(
      lines.map((l: { source: string; timestamp: number }) => [l.source, l.timestamp])
    ).toEqual([
      ["mic", START + 500],
      ["system", START + 2500],
    ]);
  });

  it("skips silence instead of sending it to the model", async () => {
    const { t, model } = make();
    feed(t, "system", pcm(10, [[0, 10]]));
    const lines = await t.finish();
    expect(model.transcribe).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("keeps going when the model fails on a piece, and counts the failure", async () => {
    const model = fakeModel();
    model.transcribe.mockRejectedValueOnce(new Error("server gone"));
    const { t } = make(model);
    feed(t, "mic", pcm(30));
    const lines = await t.finish();
    expect(t.failedPieces).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("ignores audio after the meeting ended", async () => {
    const { t, model } = make();
    feed(t, "mic", pcm(5));
    await t.finish();
    const calls = model.transcribe.mock.calls.length;
    feed(t, "mic", pcm(5));
    await t.idle();
    expect(model.transcribe.mock.calls.length).toBe(calls);
  });
});
