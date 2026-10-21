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

/**
 * Options for audio that isn't live (the Cardputer inbox reads WAV files):
 * a known time zero, a silence gate of the caller's choice, and push()
 * saying when it queued a clip so the caller can wait instead of piling
 * clips up in memory.
 */
describe("MeetingLocalTranscriber fed from a file", () => {
  const SECOND = SR * 2; // bytes of 16-bit mono PCM per second

  /** Feed a buffer in 1 s chunks; returns what each push() said. */
  function feedSeconds(t: InstanceType<typeof MeetingLocalTranscriber>, buf: Buffer) {
    const said: boolean[] = [];
    for (let i = 0; i < buf.length; i += SECOND)
      said.push(t.push("mic", buf.subarray(i, i + SECOND)));
    return said;
  }

  function makeWith(options: Record<string, unknown>, model = fakeModel()) {
    const t = new MeetingLocalTranscriber({
      sampleRate: SR,
      clipTargetS: 120,
      lookaheadS: 20,
      transcribe: model.transcribe,
      ...options,
    });
    return { t, model };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START + 987_654); // a clock that has nothing to do with the audio
  });
  afterEach(() => vi.useRealTimers());

  it("dates lines from zeroMs and the sample offset, never from the clock or the first chunk", async () => {
    const { t } = makeWith({ zeroMs: 1500 });
    feedSeconds(t, pcm(10));
    const [line] = await t.finish();
    expect(line.timestamp).toBe(1500 + 500); // first token at 0.5 s; no 1 s first-chunk subtraction
  });

  it("keeps zeroMs for every clip, so a later clip is zeroMs plus where it starts", async () => {
    const { t } = makeWith({ zeroMs: 0, clipTargetS: 10, lookaheadS: 2 });
    feedSeconds(t, pcm(30, [[10.5, 11]]));
    const lines = await t.finish();
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].timestamp).toBe(500);
    // The second clip starts in the quiet stretch (10.5-11 s): its first line is 0.5 s after that.
    expect(lines[1].timestamp).toBeGreaterThanOrEqual(11_000);
    expect(lines[1].timestamp).toBeLessThanOrEqual(11_500);
  });

  it("returns true from push() exactly when it queued a clip", async () => {
    const { t } = makeWith({ zeroMs: 0 });
    const said = feedSeconds(t, pcm(141));
    expect(said.filter(Boolean)).toHaveLength(1);
    expect(said.indexOf(true)).toBe(139); // the 140th second reaches 120 s + 20 s
    expect(t.push("mic", Buffer.alloc(0))).toBe(false);
    await t.finish();
    expect(t.push("mic", pcm(1))).toBe(false); // after the end
  });

  it("returns false from push() without the new options too", () => {
    const { t } = make();
    expect(t.push("mic", pcm(1))).toBe(false);
  });

  it("honours silenceRms: quiet speech is skipped by default and kept with a lower gate", async () => {
    // A tone at RMS ~0.0015 (int16 amplitude 70): below 0.003, above 0.0005.
    const quiet = Buffer.alloc(10 * SECOND);
    for (let i = 0; i < 10 * SR; i++) {
      quiet.writeInt16LE(Math.round(70 * Math.sin((2 * Math.PI * 220 * i) / SR)), i * 2);
    }
    const byDefault = makeWith({ zeroMs: 0 });
    feedSeconds(byDefault.t, quiet);
    expect(await byDefault.t.finish()).toEqual([]);
    expect(byDefault.model.transcribe).not.toHaveBeenCalled();

    const lowered = makeWith({ zeroMs: 0, silenceRms: 0.0005 });
    feedSeconds(lowered.t, quiet);
    expect(await lowered.t.finish()).toHaveLength(1);
  });

  it("feeds 3 h through a slow model with at most one queued clip and a bounded buffer", async () => {
    const clipTargetS = 120;
    const lookaheadS = 20;
    const zeroMs = 200;
    // Loud seconds with a softer one every 45 s, so clips are cut at lulls;
    // nothing is silent, so every sample reaches the model in order.
    const loud = pcm(1);
    const soft = Buffer.alloc(SECOND);
    for (let i = 0; i < SR; i++)
      soft.writeInt16LE(Math.round(500 * Math.sin((2 * Math.PI * 220 * i) / SR)), i * 2);

    let fedSamples = 0; // samples the model has seen so far
    const expected: number[] = [];
    const transcribe = vi.fn(async (samples: Float32Array) => {
      expected.push(zeroMs + fedSamples / 16 + 500); // piece start (ms) + first token at 0.5 s
      fedSamples += samples.length;
      await new Promise((resolve) => setTimeout(resolve, 1)); // slower than reading a file
      return { text: "一句。", tokens: ["一", "。"], timestamps: [0.5, 0.9] };
    });
    const t = new MeetingLocalTranscriber({
      sampleRate: SR,
      clipTargetS,
      lookaheadS,
      transcribe,
      zeroMs,
    });

    let maxQueued = 0;
    let maxBuffered = 0;
    for (let s = 0; s < 3 * 3600; s++) {
      const cut = t.push("mic", s % 45 === 44 ? soft : loud);
      maxQueued = Math.max(maxQueued, t.pendingClips);
      maxBuffered = Math.max(maxBuffered, t.bufferedBytes);
      if (cut) await t.idle();
    }
    const lines = await t.finish();

    expect(maxQueued).toBeLessThanOrEqual(1);
    expect(maxBuffered).toBeLessThanOrEqual((clipTargetS + lookaheadS + 1) * SECOND);
    expect(fedSamples).toBe(3 * 3600 * SR);
    expect(t.pendingClips).toBe(0);
    expect(lines.map((l: { timestamp: number }) => l.timestamp)).toEqual(expected);
  }, 120_000);
});
