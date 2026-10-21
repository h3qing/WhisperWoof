/**
 * Pure rules of the Cardputer inbox (bridge/cardputer-inbox-pure.js) and the
 * transcript files (transcript-doc.js): settings, WAV header and segment
 * checks, the runs fed to the transcriber, status/result documents, retries.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const pure = require("../../bridge/cardputer-inbox-pure");
const doc = require("./transcript-doc");
const contract = require("./contract");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const vector = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "vectors", "valid", name), "utf8")).data;

function wavHeader(dataBytes: number, overrides: Record<number, [string, number]> = {}) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataBytes, 40);
  for (const [offset, [kind, value]] of Object.entries(overrides)) {
    if (kind === "u16") b.writeUInt16LE(value, Number(offset));
    else b.writeUInt32LE(value, Number(offset));
  }
  return b;
}

describe("inbox settings", () => {
  it("is off by default, rooted at ~/CardputerNotes/recordings", () => {
    expect(pure.normalizeInboxSettings(undefined, "/Users/me")).toEqual({
      enabled: false,
      root: "/Users/me/CardputerNotes/recordings",
    });
  });

  it("keeps an absolute root and a real true, and nothing else", () => {
    expect(pure.normalizeInboxSettings({ enabled: true, root: "/Volumes/x/rec" }, "/h")).toEqual({
      enabled: true,
      root: "/Volumes/x/rec",
    });
    expect(pure.normalizeInboxSettings({ enabled: "yes", root: "rec" }, "/h")).toEqual({
      enabled: false,
      root: "/h/CardputerNotes/recordings",
    });
    expect(pure.normalizeInboxSettings({ root: "/a/\u0000b" }, "/h").root).toBe(
      "/h/CardputerNotes/recordings"
    );
  });
});

describe("WAV header", () => {
  it("accepts the canonical 16 kHz / 16-bit / mono PCM header whose lengths match the file", () => {
    expect(pure.parseWavHeader(wavHeader(64000), 64044)).toEqual({ ok: true, dataBytes: 64000 });
  });

  it.each([
    ["not RIFF", { 0: ["u32", 0] }],
    ["not PCM", { 20: ["u16", 3] }],
    ["stereo", { 22: ["u16", 2] }],
    ["44.1 kHz", { 24: ["u32", 44100] }],
    ["8-bit", { 34: ["u16", 8] }],
    ["data length 0 (an unrepaired segment)", { 40: ["u32", 0] }],
    ["RIFF length off", { 4: ["u32", 1] }],
  ])("rejects %s", (_label, overrides) => {
    expect(pure.parseWavHeader(wavHeader(64000, overrides as any), 64044).ok).toBe(false);
  });

  it("rejects a header that doesn't match the file size, or a short file", () => {
    expect(pure.parseWavHeader(wavHeader(64000), 64046).ok).toBe(false);
    expect(pure.parseWavHeader(Buffer.alloc(10), 10).ok).toBe(false);
  });
});

describe("segment checks", () => {
  const seg = { i: 0, file: "seg-000.wav", samples: 32000, bytes: 64044 };
  const file = { isSymbolicLink: false, isFile: true, size: 64044 };

  it("passes a regular file with the declared size and a good header", () => {
    expect(pure.checkSegment(seg, file, wavHeader(64000))).toBeNull();
  });

  it("ignores the session when a segment is a symlink (writes nothing)", () => {
    expect(pure.checkSegment(seg, { ...file, isSymbolicLink: true }, null)).toEqual({
      ignore: true,
    });
  });

  it("fails a missing, non-regular, resized, oversize or badly headed segment", () => {
    expect(pure.checkSegment(seg, null, null)?.code).toBe("E_INVALID");
    expect(pure.checkSegment(seg, { ...file, isFile: false }, null)?.code).toBe("E_INVALID");
    expect(pure.checkSegment(seg, { ...file, size: 64046 }, wavHeader(64002))?.code).toBe(
      "E_INVALID"
    );
    const big = { ...seg, samples: 10_500_000, bytes: 21_000_044 };
    expect(
      pure.checkSegment(big, { ...file, size: big.bytes }, wavHeader(21_000_000))?.problem
    ).toBe("too_big");
    expect(pure.checkSegment(seg, file, wavHeader(64000, { 22: ["u16", 2] }))?.problem).toBe(
      "header"
    );
  });

  it("fails a session longer than 4 hours of audio", () => {
    const m = vector("manifest_meeting.json");
    expect(pure.tooLong(m)).toBe(false);
    const long = {
      ...m,
      segments: Array.from({ length: 49 }, (_, i) => ({ ...m.segments[0], i })),
    };
    expect(pure.tooLong(long)).toBe(true); // 49 x 5 min
  });
});

describe("runs fed to the transcriber", () => {
  it("skips lead_ms at the start of segment 0, so line times are session times", () => {
    const m = vector("manifest_memo.json");
    const [run] = pure.planRuns(m);
    const s0 = m.segments[0];
    expect(run.zeroMs).toBe(m.lead_ms);
    expect(run.parts).toEqual([
      {
        file: "seg-000.wav",
        offset: 44 + m.lead_ms * 32,
        length: (s0.samples - m.lead_ms * 16) * 2,
      },
    ]);
  });

  it("starts a new run after each gap, timed by the next segment's t0_ms", () => {
    const m = vector("manifest_meeting_gaps.json"); // segments 0 and 2, gaps [1, 3]
    const runs = pure.planRuns(m);
    expect(runs.map((r: { zeroMs: number }) => r.zeroMs)).toEqual([m.lead_ms, 900_000]);
    expect(runs[1].parts).toEqual([{ file: "seg-002.wav", offset: 44, length: 976_000 * 2 }]);
  });

  it("keeps contiguous segments in one run", () => {
    const m = vector("manifest_meeting.json");
    const runs = pure.planRuns(m);
    expect(runs).toHaveLength(1);
    expect(runs[0].parts.map((p: { file: string }) => p.file)).toEqual(
      m.segments.map((s: { file: string }) => s.file)
    );
  });

  it("never skips more than segment 0 holds", () => {
    const m = vector("manifest_memo.json");
    const tiny = {
      ...m,
      lead_ms: 2000,
      segments: [{ ...m.segments[0], samples: 8000, bytes: 16044 }],
    };
    const [run] = pure.planRuns(tiny);
    expect(run.parts[0].length).toBe(0);
    expect(run.zeroMs).toBe(500);
  });
});

describe("status and result documents", () => {
  const at = "2026-10-21T14:49:02.000+08:00";

  it("formats local RFC 3339 times with the offset", () => {
    const ms = Date.parse("2026-10-21T06:49:02.000Z");
    expect(pure.rfc3339(ms, 480)).toBe(at);
    expect(pure.rfc3339(ms, -420)).toBe("2026-10-20T23:49:02.000-07:00");
    expect(pure.rfc3339(ms, 0)).toBe("2026-10-21T06:49:02.000+00:00");
  });

  it("writes contract-valid status documents", () => {
    const id = { session: "K3M9Q2T-00042-0A1C", attempt: 1 };
    for (const [state, reason] of [
      ["queued"],
      ["transcribing"],
      ["summarizing"],
      ["blocked", "busy"],
      ["blocked", "model_missing"],
      ["blocked", "disabled"],
    ]) {
      const s = pure.statusDoc({ ...id, state, reason, at });
      expect(contract.validateDoc("status", s), `${state} ${reason}`).toEqual({
        code: "ok",
        fields: [],
      });
    }
    expect(() => pure.statusDoc({ ...id, state: "blocked", at })).toThrow();
  });

  it("says when a status changes", () => {
    const a = { state: "transcribing", reason: null };
    expect(pure.statusChanged(null, a)).toBe(true);
    expect(pure.statusChanged(a, { ...a })).toBe(false);
    expect(pure.statusChanged(a, { state: "blocked", reason: "busy" })).toBe(true);
  });

  it("writes a contract-valid failed result only when it can name the session", () => {
    const m = vector("manifest_meeting.json");
    const identity = pure.failureIdentity(m);
    expect(identity).toEqual({ session: m.session, attempt: 1, mode: "meeting" });
    const r = pure.failedResult({ identity, code: "E_INVALID", retryable: false, finishedAt: at });
    expect(contract.validateDoc("result", r)).toEqual({ code: "ok", fields: [] });
    expect(r).toMatchObject({ state: "failed", error: { code: "E_INVALID", retryable: false } });
    expect(pure.failureIdentity({ ...m, attempt: 0 })?.attempt).toBe(1);
    expect(pure.failureIdentity({ ...m, session: "../x" })).toBeNull();
    expect(pure.failureIdentity({ ...m, mode: "song" })).toBeNull();
    expect(pure.failureIdentity("nope")).toBeNull();
  });

  it("writes a contract-valid transcript-level result", () => {
    const m = vector("manifest_memo.json");
    const r = pure.transcriptResult({
      manifest: m,
      outputs: {
        transcript_json: { path: "transcript.json", sha256: "a".repeat(64) },
        transcript_md: { path: "transcript.md", sha256: "b".repeat(64) },
      },
      app: "WhisperWoof/2.8.1",
      finishedAt: at,
    });
    expect(contract.validateDoc("result", r)).toEqual({ code: "ok", fields: [] });
    expect(r).toMatchObject({ state: "done", level: "transcript", mode: "memo", error: null });
    expect(r.pipeline).toEqual({
      app: "WhisperWoof/2.8.1",
      stt: pure.STT_ENGINE,
      llm: null,
      prompt: null,
    });
  });
});

describe("retries and errors", () => {
  it("backs off and gives up after 3 retries", () => {
    expect(pure.MAX_RETRIES).toBe(3);
    expect([0, 1, 2].map(pure.retryDelayMs)).toEqual([30_000, 120_000, 480_000]);
    expect(pure.retryDelayMs(9)).toBe(480_000);
  });

  it("names errors by contract code: file-system errors are E_IO and retryable", () => {
    expect(pure.classifyError(Object.assign(new Error("x"), { code: "EIO" }))).toEqual({
      code: "E_IO",
      retryable: true,
    });
    expect(pure.classifyError(Object.assign(new Error("x"), { cardputerCode: "E_STT" }))).toEqual({
      code: "E_STT",
      retryable: true,
    });
    expect(pure.classifyError(Object.assign(new Error("x"), { cardputerCode: "E_AUDIO" }))).toEqual(
      { code: "E_AUDIO", retryable: false }
    );
    expect(pure.classifyError(new Error("anything else"))).toEqual({
      code: "E_IO",
      retryable: true,
    });
  });

  it("does memos before meetings, then oldest first", () => {
    const list = [
      { dir: "/r/2026-10-21/1405-b", mode: "meeting" },
      { dir: "/r/2026-10-21/1402-a", mode: "meeting" },
      { dir: "/r/2026-10-21/1410-c", mode: "memo" },
    ];
    expect(pure.orderCandidates(list).map((c: { dir: string }) => c.dir)).toEqual([
      "/r/2026-10-21/1410-c",
      "/r/2026-10-21/1402-a",
      "/r/2026-10-21/1405-b",
    ]);
    expect(list[0].dir).toBe("/r/2026-10-21/1405-b"); // input untouched
  });
});

describe("transcript files", () => {
  const lines = [
    { timestamp: 12_340, text: " 第二句。 " },
    { timestamp: 2_000, text: "第一句。" },
    { timestamp: 12_900, text: "同一秒\n第三句。" },
    { timestamp: 3_725_000, text: "an hour in" },
    { timestamp: 5_000, text: "   " },
  ];

  it("sorts lines by time, cleans them and drops empty ones", () => {
    const sentences = doc.buildSentences(lines, (t: string) => t.replace("句", "句"));
    expect(sentences).toEqual([
      { t_ms: 2_000, text: "第一句。" },
      { t_ms: 12_340, text: "第二句。" },
      { t_ms: 12_900, text: "同一秒 第三句。" },
      { t_ms: 3_725_000, text: "an hour in" },
    ]);
  });

  it("gives every line a unique ^tHHMMSS block id", () => {
    const sentences = doc.buildSentences(lines, (t: string) => t);
    expect(doc.blockIds(sentences)).toEqual(["t000002", "t000012", "t000012-2", "t010205"]);
  });

  it("renders transcript.md as one line per sentence with clock and block id", () => {
    const sentences = doc.buildSentences(lines, (t: string) => t);
    const md = doc.transcriptMarkdown({ session: "K3M9Q2T-00042-0A1C", sentences });
    expect(md).toContain("- [00:02] 第一句。 ^t000002\n");
    expect(md).toContain("- [00:12] 同一秒 第三句。 ^t000012-2\n");
    expect(md).toContain("- [1:02:05] an hour in ^t010205\n");
    expect(md.startsWith("---\nsession: K3M9Q2T-00042-0A1C\nsource: cardputer\n---\n")).toBe(true);
  });

  it("renders a contract-valid transcript.json", () => {
    const sentences = doc.buildSentences(lines, (t: string) => t);
    const json = doc.transcriptJson({
      session: "K3M9Q2T-00042-0A1C",
      attempt: 1,
      leadMs: 200,
      sentences,
      stt: pure.STT_ENGINE,
    });
    expect(contract.validateDoc("transcript", json)).toEqual({ code: "ok", fields: [] });
    expect(json.sentences).toEqual(sentences);
  });
});
