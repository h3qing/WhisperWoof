/**
 * Converting recorded audio to 16 kHz WAV through ffmpeg pipes, so no
 * plaintext copy of the user's voice is written to the temp folder.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { pcmToWav, convertBufferToWav } = require("../../../helpers/ffmpegUtils.js");
const FFMPEG = require("ffmpeg-static");

describe("pcmToWav", () => {
  it("writes a 44-byte PCM header that matches the data", () => {
    const pcm = Buffer.alloc(3200, 1);
    const wav = pcmToWav(pcm, { sampleRate: 16000, channels: 1 });
    expect(wav).toHaveLength(44 + 3200);
    expect(wav.toString("latin1", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 3200);
    expect(wav.toString("latin1", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(32000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("latin1", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(3200);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });
});

describe.runIf(Boolean(FFMPEG) && fs.existsSync(FFMPEG))("convertBufferToWav (real ffmpeg)", () => {
  it("turns a webm/opus recording into 16 kHz mono WAV without touching the temp folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-pipe-"));
    const webm = path.join(dir, "in.webm");
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", webm]);
    const input = fs.readFileSync(webm);
    fs.rmSync(dir, { recursive: true, force: true });

    const before = new Set(fs.readdirSync(os.tmpdir()));
    const wav = await convertBufferToWav(input, { sampleRate: 16000, channels: 1 });
    const created = fs.readdirSync(os.tmpdir()).filter((n) => !before.has(n) && /whisper|parakeet|input|output/.test(n));

    expect(created).toEqual([]);
    expect(wav.toString("latin1", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    const seconds = wav.readUInt32LE(40) / 32000;
    expect(seconds).toBeGreaterThan(0.9);
    expect(seconds).toBeLessThan(1.1);
  });

  it("rejects input ffmpeg can't read", async () => {
    await expect(convertBufferToWav(Buffer.from("not audio at all"), {})).rejects.toThrow();
  });
});
