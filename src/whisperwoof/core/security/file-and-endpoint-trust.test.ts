/**
 * Main reads a user's file only when it's the audio file it claims to be,
 * and sends audio and API keys only over HTTPS (or to this machine / the LAN).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveUserAudioFile } = require("../../bridge/user-audio-file.js");
const { isSecureEndpoint, isPrivateHost } = require("../../bridge/endpoint-pure.js");

let dir = "";
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ww-audio-")));
  fs.writeFileSync(path.join(dir, "voice memo.m4a"), "audio");
  fs.writeFileSync(path.join(dir, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("resolveUserAudioFile", () => {
  it("accepts an audio file anywhere, by its real path", () => {
    expect(resolveUserAudioFile(path.join(dir, "voice memo.m4a"))).toBe(path.join(dir, "voice memo.m4a"));
    expect(resolveUserAudioFile(path.join(dir, "sub", "..", "voice memo.m4a"))).toBe(
      path.join(dir, "voice memo.m4a")
    );
  });

  it("refuses anything that isn't an audio file", () => {
    expect(resolveUserAudioFile(path.join(dir, "id_rsa"))).toBe(null);
    expect(resolveUserAudioFile(dir)).toBe(null); // a folder
    expect(resolveUserAudioFile(path.join(dir, "missing.mp3"))).toBe(null);
    expect(resolveUserAudioFile("voice memo.m4a")).toBe(null); // relative
    expect(resolveUserAudioFile(`${path.join(dir, "voice memo.m4a")}\0.png`)).toBe(null);
    expect(resolveUserAudioFile(undefined)).toBe(null);
  });

  it("follows symlinks before judging: voice.mp3 -> id_rsa is refused", () => {
    const link = path.join(dir, "voice.mp3");
    fs.symlinkSync(path.join(dir, "id_rsa"), link);
    expect(resolveUserAudioFile(link)).toBe(null);
  });
});

describe("isSecureEndpoint", () => {
  it("allows HTTPS anywhere", () => {
    expect(isSecureEndpoint("https://api.openai.com/v1")).toBe(true);
  });

  it("allows plain http only to this machine or a private literal address", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
      "http://192.168.1.20:9000",
      "http://10.0.0.5",
      "http://172.20.1.1",
      "http://mac-studio.local:8000",
    ]) {
      expect(isSecureEndpoint(url)).toBe(true);
    }
  });

  it("refuses public names that only look private, and other schemes", () => {
    for (const url of [
      "http://10.attacker.com/v1",
      "http://192.168.evil.net",
      "http://127.0.0.1.nip.io",
      "http://172.32.0.1",
      "http://api.example.com",
      "ftp://127.0.0.1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isSecureEndpoint(url)).toBe(false);
    }
    expect(isPrivateHost("300.1.1.1")).toBe(false);
  });
});
