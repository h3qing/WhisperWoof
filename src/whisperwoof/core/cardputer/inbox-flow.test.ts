/**
 * The Cardputer inbox end to end on a temp folder (inbox-runner.js +
 * process-session.js + session-files.js + bridge/cardputer-writeback.js),
 * with a fake SenseVoice: what gets written, in which order, with which
 * times; and the hand-off rules — result.json last, never touched again,
 * deleting it reprocesses.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { tempRoot, writeSession, fakeSenseVoice, readJson, snapshot, tone } from "./test-sessions";

const require = createRequire(import.meta.url);
const { createInboxRunner } = require("./inbox-runner");
const contract = require("./contract");
const writeback = require("../../bridge/cardputer-writeback");

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setup(options: Record<string, unknown> = {}) {
  const root = tempRoot();
  roots.push(root);
  const stt = fakeSenseVoice();
  const writes: string[] = [];
  let clock = Date.parse("2026-10-21T06:49:02.000Z");
  const runner = createInboxRunner({
    root,
    transcribe: stt.transcribe,
    ensureModel: async () => true,
    postProcess: (t: string) => t,
    now: () => clock,
    tzOffsetMin: () => 480,
    app: "WhisperWoof/test",
    write: (dir: string, name: string, data: string) => {
      const label = name === "status.json" ? `status:${JSON.parse(data).state}` : name;
      writes.push(`${path.basename(dir)}/${label}`);
      return writeback.writeAtomic(dir, name, data);
    },
    ...options,
  });
  return { root, runner, stt, writes, advance: (ms: number) => (clock += ms) };
}

const sha = (file: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("Cardputer inbox flow", () => {
  it("transcribes a 1-segment memo and writes result.json last", async () => {
    const { root, runner, writes } = setup();
    const { dir, session } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 6, t0_ms: 0 }],
    });
    const name = path.basename(dir);

    await runner.runOnce();

    expect(writes).toEqual([
      `${name}/status:queued`,
      `${name}/status:transcribing`,
      `${name}/transcript.json`,
      `${name}/transcript.md`,
      `${name}/result.json`,
    ]);
    const transcript = readJson(dir, "transcript.json");
    expect(contract.validateDoc("transcript", transcript).code).toBe("ok");
    expect(transcript.sentences).toEqual([{ t_ms: 200 + 500, text: "第1句。" }]); // lead skipped, session time
    const result = readJson(dir, "result.json");
    expect(contract.validateDoc("result", result)).toEqual({ code: "ok", fields: [] });
    expect(result).toMatchObject({
      session,
      state: "done",
      level: "transcript",
      mode: "memo",
      error: null,
    });
    expect(result.outputs.transcript_json.sha256).toBe(sha(path.join(dir, "transcript.json")));
    expect(result.outputs.transcript_md.sha256).toBe(sha(path.join(dir, "transcript.md")));
    expect(result.finished_at).toBe("2026-10-21T14:49:02.000+08:00");
    expect(fs.readFileSync(path.join(dir, "transcript.md"), "utf8")).toContain(
      "- [00:00] 第1句。 ^t000000\n"
    );
    for (const f of ["status.json", "transcript.json", "transcript.md", "result.json"]) {
      expect(fs.statSync(path.join(dir, f)).mode & 0o777, f).toBe(0o600);
    }
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("."))).toEqual([]); // no temp files left
  });

  it("keeps session time across a gap in a 3-segment meeting", async () => {
    const { root, runner } = setup();
    // Segment 2 never arrived: segment 3 starts at 9 s of session time.
    const { dir } = writeSession(root, {
      mode: "meeting",
      segments: [
        { i: 0, seconds: 3, t0_ms: 0 },
        { i: 1, seconds: 3, t0_ms: 3000 },
        { i: 3, seconds: 2, t0_ms: 9000 },
      ],
      gaps: [2],
      marks: [{ t_ms: 9200, k: "star" }],
    });

    await runner.runOnce();

    const { sentences } = readJson(dir, "transcript.json");
    expect(sentences.map((s: { t_ms: number }) => s.t_ms)).toEqual([700, 9500]);
    expect(readJson(dir, "result.json")).toMatchObject({ state: "done", mode: "meeting" });
  });

  it("does memos first, and never touches a folder again once result.json is there", async () => {
    const { root, runner, writes } = setup();
    const meeting = writeSession(root, {
      mode: "meeting",
      first: 0x100,
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const memo = writeSession(root, {
      mode: "memo",
      first: 0x200,
      dirName: "1500-later",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    const results = writes.filter((w) => w.endsWith("result.json"));
    expect(results).toEqual([
      `${path.basename(memo.dir)}/result.json`,
      `${path.basename(meeting.dir)}/result.json`,
    ]);

    const before = [snapshot(meeting.dir), snapshot(memo.dir)];
    writes.length = 0;
    await runner.runOnce();
    await runner.runOnce();
    expect(writes).toEqual([]);
    expect([snapshot(meeting.dir), snapshot(memo.dir)]).toEqual(before);
  });

  it("reprocesses a session when the user deletes result.json, overwriting its own files", async () => {
    const { root, runner, writes } = setup();
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    fs.writeFileSync(path.join(dir, "transcript.md"), "edited by the user");
    fs.unlinkSync(path.join(dir, "result.json"));
    writes.length = 0;

    await runner.runOnce();

    expect(writes.at(-1)).toBe(`${path.basename(dir)}/result.json`);
    expect(fs.readFileSync(path.join(dir, "transcript.md"), "utf8")).toContain("^t000000");
    expect(readJson(dir, "result.json").state).toBe("done");
  });

  it("stops writing when result.json shows up while it works", async () => {
    const root = tempRoot();
    roots.push(root);
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const runner = createInboxRunner({
      root,
      ensureModel: async () => true,
      transcribe: async () => {
        fs.writeFileSync(path.join(dir, "result.json"), "{}"); // someone else finished it
        return { text: "x。", tokens: ["x", "。"], timestamps: [0, 0.1] };
      },
    });
    await runner.runOnce();
    expect(fs.readFileSync(path.join(dir, "result.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(dir, "transcript.json"))).toBe(false);
  });

  it("waits with status blocked/model_missing until SenseVoice is there", async () => {
    let ready = false;
    const { root, runner, writes } = setup({ ensureModel: async () => ready });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    expect(readJson(dir, "status.json")).toMatchObject({
      state: "blocked",
      reason: "model_missing",
    });
    expect(fs.existsSync(path.join(dir, "result.json"))).toBe(false);
    ready = true;
    await runner.runOnce();
    expect(readJson(dir, "result.json").state).toBe("done");
    expect(writes.filter((w) => w.includes("status:"))).toEqual([
      `${path.basename(dir)}/status:queued`,
      `${path.basename(dir)}/status:blocked`,
      `${path.basename(dir)}/status:transcribing`,
    ]);
  });

  it("waits for the background gate before each piece (blocked/busy while dictation is active)", async () => {
    let waits = 2;
    const { root, runner, writes } = setup({ gateDelayMs: () => (waits-- > 0 ? 5 : 0) });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    const name = path.basename(dir);
    expect(writes).toEqual([
      `${name}/status:queued`,
      `${name}/status:transcribing`,
      `${name}/status:blocked`,
      `${name}/status:transcribing`,
      `${name}/transcript.json`,
      `${name}/transcript.md`,
      `${name}/result.json`,
    ]);
  });

  it("retries a failed transcription 3 times with back-off, then writes failed/E_STT", async () => {
    const { root, runner, advance } = setup({
      transcribe: async () => {
        throw new Error("server gone");
      },
    });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    for (const wait of [30_000, 120_000, 480_000]) {
      await runner.runOnce();
      expect(fs.existsSync(path.join(dir, "result.json"))).toBe(false);
      await runner.runOnce(); // too early: nothing happens
      advance(wait);
    }
    await runner.runOnce();
    expect(readJson(dir, "result.json")).toMatchObject({
      state: "failed",
      error: { code: "E_STT", retryable: true },
    });
    expect(fs.existsSync(path.join(dir, "transcript.json"))).toBe(false);
  });

  it("marks the session blocked/disabled when the inbox is turned off mid-way", async () => {
    const holder: { runner?: any } = {};
    const { root, runner } = setup({
      transcribe: async () => {
        holder.runner.abort();
        return { text: "x。", tokens: ["x", "。"], timestamps: [0, 0.1] };
      },
    });
    holder.runner = runner;
    const { dir } = writeSession(root, {
      mode: "meeting",
      segments: [{ i: 0, seconds: 200, t0_ms: 0, pcm: tone(200, [[130, 131]]) }],
    });
    await runner.runOnce();
    expect(readJson(dir, "status.json")).toMatchObject({ state: "blocked", reason: "disabled" });
    expect(fs.existsSync(path.join(dir, "result.json"))).toBe(false);
  });

  it("reports what it did", async () => {
    const { root, runner } = setup();
    writeSession(root, { mode: "memo", segments: [{ i: 0, seconds: 2, t0_ms: 0 }] });
    const outcomes = await runner.runOnce();
    expect(outcomes.map((o: { kind: string }) => o.kind)).toEqual(["done"]);
    expect(await runner.runOnce()).toEqual([]);
  });

  it("does nothing when the root folder doesn't exist yet", async () => {
    const runner = createInboxRunner({
      root: "/nonexistent/cardputer/recordings",
      ensureModel: async () => true,
    });
    expect(await runner.runOnce()).toEqual([]);
  });
});
