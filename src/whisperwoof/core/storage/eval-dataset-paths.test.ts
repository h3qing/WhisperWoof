/**
 * Eval dataset file handling against a real temp userData folder: rating a
 * transcription copies audio only from the app's own recordings folder
 * (the path comes from the renderer), and deleting an eval entry removes
 * only files inside the eval-audio folder (the path comes from a JSON file).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let base = "";
let userData = "";
let recordingsDir = "";
let evalAudioDir = "";
let secret = "";

function load() {
  const inject = (request: string, exports: unknown) => {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
  };
  inject("electron", { app: { getPath: () => userData } });
  inject("../../../helpers/debugLogger.js", { log: vi.fn(), debug: vi.fn(), warn: vi.fn() });
  delete require.cache[require.resolve("../../bridge/eval-dataset.js")];
  return require("../../bridge/eval-dataset.js");
}

function write(file: string, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const rate = (audioSourcePath: unknown) =>
  load().rateTranscription({ entryId: "1", rating: 1, rawTranscript: "hi", audioSourcePath });

const evalClips = () => (fs.existsSync(evalAudioDir) ? fs.readdirSync(evalAudioDir) : []);

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "ww-eval-"));
  userData = path.join(base, "userData");
  recordingsDir = path.join(userData, "audio");
  evalAudioDir = path.join(userData, "eval-audio");
  fs.mkdirSync(recordingsDir, { recursive: true });
  secret = write(path.join(base, "home", ".ssh", "id_rsa"), "PRIVATE KEY");
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("rateTranscription audioSourcePath", () => {
  it("copies a recording from the app's audio folder into eval-audio", () => {
    const clip = write(path.join(recordingsDir, "2026-09-25_10-00-00_1.webm"), "voice");
    const entry = rate(clip);
    expect(path.dirname(entry.audioPath)).toBe(evalAudioDir);
    expect(fs.readFileSync(entry.audioPath, "utf-8")).toBe("voice");
  });

  it("refuses a file outside the app folders", () => {
    const entry = rate(secret);
    expect(entry.audioPath).toBeNull();
    expect(evalClips()).toEqual([]);
  });

  it("refuses `..` traversal out of the audio folder", () => {
    const entry = rate(path.join(recordingsDir, "..", "..", "home", ".ssh", "id_rsa"));
    expect(entry.audioPath).toBeNull();
    expect(evalClips()).toEqual([]);
  });

  it("refuses a symlink in the audio folder that points outside it", () => {
    const link = path.join(recordingsDir, "clip.webm");
    fs.symlinkSync(secret, link);
    expect(rate(link).audioPath).toBeNull();
    expect(evalClips()).toEqual([]);
  });

  it("refuses files in other app folders, relative paths and non-strings", () => {
    const image = write(path.join(userData, "whisperwoof-images", "a.png"));
    expect(rate(image).audioPath).toBeNull();
    expect(rate("audio/clip.webm").audioPath).toBeNull();
    expect(rate({ path: secret }).audioPath).toBeNull();
    expect(evalClips()).toEqual([]);
  });

  it("still records the rating when the audio is refused", () => {
    rate(secret);
    const entries = load().getEvalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entryId: "1", rating: 1, audioPath: null });
  });

  it("still saves an audio buffer into eval-audio", () => {
    const entry = load().rateTranscription({ rating: -1, audioBuffer: Buffer.from("buf") });
    expect(path.dirname(entry.audioPath)).toBe(evalAudioDir);
    expect(fs.readFileSync(entry.audioPath, "utf-8")).toBe("buf");
  });
});

describe("deleteEvalEntry", () => {
  const writeDataset = (audioPath: string) =>
    write(path.join(userData, "eval-dataset.json"), JSON.stringify({ entries: [{ id: "e1", rating: 1, audioPath }] }));

  it("removes the eval clip it saved", () => {
    const entry = rate(write(path.join(recordingsDir, "1.webm")));
    load().deleteEvalEntry(entry.id);
    expect(fs.existsSync(entry.audioPath)).toBe(false);
    expect(load().getEvalEntries()).toEqual([]);
  });

  it("never deletes a file outside eval-audio named in the dataset", () => {
    writeDataset(secret);
    load().deleteEvalEntry("e1");
    expect(fs.existsSync(secret)).toBe(true);
    expect(load().getEvalEntries()).toEqual([]);
  });

  it("never deletes an app recording named in the dataset", () => {
    const recording = write(path.join(recordingsDir, "1.webm"));
    writeDataset(recording);
    load().deleteEvalEntry("e1");
    expect(fs.existsSync(recording)).toBe(true);
  });

  it("never follows a symlink in eval-audio out of it", () => {
    const link = path.join(evalAudioDir, "escape.webm");
    fs.mkdirSync(evalAudioDir, { recursive: true });
    fs.symlinkSync(secret, link);
    writeDataset(link);
    load().deleteEvalEntry("e1");
    expect(fs.existsSync(secret)).toBe(true);
  });
});
