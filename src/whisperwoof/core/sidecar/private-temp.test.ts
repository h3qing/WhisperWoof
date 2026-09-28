/**
 * Transient audio and downloads go in a fresh mkdtemp dir (unguessable name,
 * 0700) instead of predictable names in a shared /tmp; ffmpeg inputs are
 * restricted to local files and pipes.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { makePrivateTempDir, removeTempDir, getSafeTempDir } = require(
  "../../../helpers/safeTempDir.js"
);
const { ffmpegInputArgs, convertToWav } = require("../../../helpers/ffmpegUtils.js");
const FFMPEG = require("ffmpeg-static");

describe("makePrivateTempDir", () => {
  it("creates a unique, owner-only directory under the safe temp dir", () => {
    const a = makePrivateTempDir("ww-test-");
    const b = makePrivateTempDir("ww-test-");
    try {
      expect(a).not.toBe(b);
      expect(path.dirname(a)).toBe(getSafeTempDir());
      expect(path.basename(a)).toMatch(/^ww-test-.{6}$/);
      if (process.platform !== "win32") {
        expect(fs.statSync(a).mode & 0o777).toBe(0o700);
      }
    } finally {
      removeTempDir(a);
      removeTempDir(b);
    }
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
  });

  it("removeTempDir removes contents and tolerates a missing or empty path", () => {
    const dir = makePrivateTempDir("ww-test-");
    fs.writeFileSync(path.join(dir, "input.webm"), "x", { mode: 0o600 });
    removeTempDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(() => removeTempDir(dir)).not.toThrow();
    expect(() => removeTempDir(null)).not.toThrow();
  });
});

describe("ffmpegInputArgs", () => {
  it("puts the protocol whitelist right before each -i", () => {
    expect(ffmpegInputArgs("pipe:0")).toEqual(["-protocol_whitelist", "file,pipe", "-i", "pipe:0"]);
    expect(ffmpegInputArgs("/tmp/x/input.webm")).toEqual([
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      "/tmp/x/input.webm",
    ]);
  });
});

describe.runIf(Boolean(FFMPEG) && fs.existsSync(FFMPEG))("ffmpeg protocol whitelist (real ffmpeg)", () => {
  it("converts a local file but refuses a playlist that points at the network", async () => {
    const dir = makePrivateTempDir("ww-ff-");
    try {
      const webm = path.join(dir, "in.webm");
      execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", webm]);
      await convertToWav(webm, path.join(dir, "out.wav"), { sampleRate: 16000, channels: 1 });
      expect(fs.statSync(path.join(dir, "out.wav")).size).toBeGreaterThan(30000);

      const playlist = path.join(dir, "evil.m3u8");
      fs.writeFileSync(playlist, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/a.ts\n#EXT-X-ENDLIST\n");
      await expect(
        convertToWav(playlist, path.join(dir, "evil.wav"), { sampleRate: 16000, channels: 1 })
      ).rejects.toThrow();
    } finally {
      removeTempDir(dir);
    }
  });
});
