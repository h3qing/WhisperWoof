/**
 * Meeting crash buffer with encryption on: segments are sealed streams,
 * recording keeps going after WhisperWoof locks, and a crash mid-segment
 * loses at most the last second.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const FAST = { N: 1024, r: 8, p: 1 };
const ONE_SECOND = 24000 * 2;

let userData = "";
let baseDir = "";

function boot() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userData, isReady: () => false } },
  } as unknown as NodeJS.Module;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js") || key.endsWith("meetingAudioBuffer.js")) {
      delete require.cache[key];
    }
  }
  return {
    vault: require("../../bridge/vault/vault-service.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    ww: require("../../bridge/vault/wwenc-pure.js"),
    MeetingAudioBuffer: require("../../../helpers/meetingAudioBuffer.js"),
  };
}

async function encryptionOn(m: ReturnType<typeof boot>) {
  const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-meet-ud-"));
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-meet-tmp-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("sealed meeting segments", () => {
  it("writes sealed PCM that decrypts to exactly what was recorded", async () => {
    const m = boot();
    await encryptionOn(m);
    const buffer = new m.MeetingAudioBuffer(baseDir);
    buffer.start();
    const parts = [crypto.randomBytes(ONE_SECOND / 3), crypto.randomBytes(ONE_SECOND * 2 + 7), crypto.randomBytes(100)];
    for (const p of parts) buffer.writeChunk(p, "mic");
    const { files } = buffer.stop({ keepFiles: true });

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/mic-0000\.pcm\.wwenc$/);
    const sealed = fs.readFileSync(files[0]);
    expect(sealed.includes(parts[1].subarray(0, 64))).toBe(false);
    const out = m.ww.decrypt(sealed, m.vault.requireKeys().sealPrivateKey);
    expect(out.complete).toBe(true);
    expect(out.plaintext.equals(Buffer.concat(parts))).toBe(true);
  });

  it("keeps recording after WhisperWoof locks (the public key is enough)", async () => {
    const m = boot();
    await encryptionOn(m);
    const buffer = new m.MeetingAudioBuffer(baseDir);
    buffer.start();
    buffer.writeChunk(crypto.randomBytes(ONE_SECOND), "system");
    await m.vault.lock();
    buffer.writeChunk(crypto.randomBytes(ONE_SECOND), "system");
    const { files } = buffer.stop({ keepFiles: true });
    await m.vault.unlockWithPassword("a good password");
    const out = m.ww.decrypt(fs.readFileSync(files[0]), m.vault.requireKeys().sealPrivateKey);
    expect(out.plaintext).toHaveLength(2 * ONE_SECOND);
  });

  it("recovers everything but the last partial second after a crash", async () => {
    const m = boot();
    await encryptionOn(m);
    const buffer = new m.MeetingAudioBuffer(baseDir);
    buffer.start();
    const audio = crypto.randomBytes(ONE_SECOND * 3 + 500);
    buffer.writeChunk(audio, "mic");
    // Crash: the segment is never closed. Read what's on disk right now.
    const file = fs.readdirSync(buffer.getSessionDir()).map((n) => path.join(buffer.getSessionDir(), n))[0];
    const out = m.ww.decrypt(fs.readFileSync(file), m.vault.requireKeys().sealPrivateKey, { allowPartial: true });
    expect(out.complete).toBe(false);
    expect(out.plaintext.equals(audio.subarray(0, ONE_SECOND * 3))).toBe(true);
    buffer.stop({ keepFiles: true });
  });

  it("still writes plain WAV when encryption is off", () => {
    const m = boot();
    const buffer = new m.MeetingAudioBuffer(baseDir);
    buffer.start();
    buffer.writeChunk(crypto.randomBytes(1000), "mic");
    const { files } = buffer.stop({ keepFiles: true });
    expect(files[0]).toMatch(/mic-0000\.wav$/);
    expect(fs.readFileSync(files[0]).subarray(0, 4).toString()).toBe("RIFF");
  });
});
