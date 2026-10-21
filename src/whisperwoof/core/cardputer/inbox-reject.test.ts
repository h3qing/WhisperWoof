/**
 * The Cardputer inbox treats the recordings folder as untrusted input:
 * invalid sessions get result.json failed/E_INVALID (or E_VERSION), and
 * symlinks or paths leaving the root are left alone without writing a thing.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import {
  tempRoot,
  writeSession,
  fakeSenseVoice,
  readJson,
  snapshot,
  tone,
  wav,
} from "./test-sessions";

const require = createRequire(import.meta.url);
const { createInboxRunner } = require("./inbox-runner");
const contract = require("./contract");

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setup() {
  const root = tempRoot();
  roots.push(root);
  const stt = fakeSenseVoice();
  const runner = createInboxRunner({
    root,
    transcribe: stt.transcribe,
    ensureModel: async () => true,
  });
  return { root, runner, stt };
}

const memo = { mode: "memo" as const, segments: [{ i: 0, seconds: 2, t0_ms: 0 }] };

async function failedWith(root: string, runner: any, dir: string) {
  await runner.runOnce();
  const result = readJson(dir, "result.json");
  expect(contract.validateDoc("result", result)).toEqual({ code: "ok", fields: [] });
  expect(fs.existsSync(path.join(dir, "transcript.json"))).toBe(false);
  return result.error;
}

describe("Cardputer inbox: invalid sessions", () => {
  it("fails a manifest whose segment path leaves the folder (E_INVALID)", async () => {
    const { root, runner, stt } = setup();
    const { dir } = writeSession(root, {
      ...memo,
      manifest: (m) => ({ ...m, segments: [{ ...m.segments[0], file: "../seg-000.wav" }] }),
    });
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_INVALID", retryable: false });
    expect(stt.pieces).toEqual([]);
  });

  it("fails a v=2 manifest with E_VERSION", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, { ...memo, manifest: (m) => ({ ...m, v: 2 }) });
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_VERSION", retryable: false });
  });

  it("fails when the audio doesn't match its sha256", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, memo);
    const file = path.join(dir, "seg-000.wav");
    const bytes = fs.readFileSync(file);
    bytes[1000] ^= 0xff;
    fs.writeFileSync(file, bytes);
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_INVALID", retryable: false });
  });

  it("fails a segment with a bad header (stereo)", async () => {
    const { root, runner } = setup();
    const pcm = tone(2);
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0, pcm }],
    });
    const file = path.join(dir, "seg-000.wav");
    fs.writeFileSync(file, wav(pcm, { channels: 2 }));
    // keep the manifest's sha in line, so only the header is wrong
    const m = readJson(dir, "manifest.json");
    m.segments[0].sha256 = require("crypto")
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_INVALID", retryable: false });
  });

  it("fails an oversize segment file (over 20 MB)", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, memo);
    fs.writeFileSync(path.join(dir, "seg-000.wav"), Buffer.alloc(21 * 1024 * 1024));
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_INVALID", retryable: false });
  });

  it("fails a missing segment file", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, memo);
    fs.unlinkSync(path.join(dir, "seg-000.wav"));
    expect(await failedWith(root, runner, dir)).toEqual({ code: "E_INVALID", retryable: false });
  });

  it("writes nothing for a symlinked segment", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, memo);
    const real = path.join(root, "elsewhere.wav");
    fs.renameSync(path.join(dir, "seg-000.wav"), real);
    fs.symlinkSync(real, path.join(dir, "seg-000.wav"));
    const before = snapshot(dir);
    await runner.runOnce();
    expect(snapshot(dir)).toBe(before);
  });

  it("writes nothing for a symlinked session folder or manifest, or a folder outside the root", async () => {
    const { root, runner } = setup();
    const outside = tempRoot();
    roots.push(outside);
    const away = writeSession(outside, memo);
    fs.symlinkSync(away.dir, path.join(root, "2026-10-21-link"));
    fs.mkdirSync(path.join(root, "2026-10-22"));
    fs.symlinkSync(away.dir, path.join(root, "2026-10-22", "1402-linked"));
    fs.symlinkSync(path.join(outside, "2026-10-21"), path.join(root, "2026-10-23"));
    const local = writeSession(root, { ...memo, date: "2026-10-24" });
    fs.unlinkSync(path.join(local.dir, "manifest.json"));
    fs.symlinkSync(path.join(away.dir, "manifest.json"), path.join(local.dir, "manifest.json"));
    const before = [snapshot(away.dir), snapshot(local.dir)];
    expect(await runner.runOnce()).toEqual([]);
    expect([snapshot(away.dir), snapshot(local.dir)]).toEqual(before);
  });

  it("writes nothing when the manifest can't name its session (unreadable JSON)", async () => {
    const { root, runner } = setup();
    const { dir } = writeSession(root, memo);
    fs.writeFileSync(path.join(dir, "manifest.json"), "{ not json");
    const before = snapshot(dir);
    await runner.runOnce();
    expect(snapshot(dir)).toBe(before);
  });

  it("ignores temp files, dot folders and non-date folders", async () => {
    const { root, runner } = setup();
    writeSession(root, { ...memo, date: ".hidden" });
    writeSession(root, { ...memo, date: "notes" });
    writeSession(root, { ...memo, dirName: ".1402-tmp" });
    expect(await runner.runOnce()).toEqual([]);
  });
});
