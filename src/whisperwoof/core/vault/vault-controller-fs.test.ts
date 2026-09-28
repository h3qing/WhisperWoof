/**
 * What the lock screen and the Encryption settings can ask main for, on a real
 * vault in a temp userData: the wait after wrong passwords, the recovery phrase
 * while unlocked, settings changes while locked, and Touch ID (the Secure
 * Enclave helper stubbed; the key math is the real one, in software).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const PASSWORD = "a good password";
const FAST = { N: 1024, r: 8, p: 1 };

// Each test runs the real password KDF (scrypt 2^18) a few times: 2-4 s alone,
// and past the 5 s default on a CI runner busy with the other vault files.
vi.setConfig({ testTimeout: 30_000 });

let userData = "";
const clipboardWrites: string[] = [];

/** A software stand-in for the Secure Enclave key, and the helper around it. */
function fakeHelper() {
  const vc = require("../../bridge/vault/vault-crypto-pure.js");
  const key = vc.p256Generate();
  const helper = {
    invalidated: false,
    created: 0,
    getAvailability: async () => ({ available: true }),
    createKey: async () => {
      helper.created += 1;
      return { publicKey: key.publicX963, keyBlob: Buffer.from("blob") };
    },
    deriveSecret: async ({ peer }: { peer: Buffer }) => {
      if (helper.invalidated) throw Object.assign(new Error("Touch ID needs to be set up again"), { code: "INVALIDATED" });
      return vc.p256Shared(key.privateKey, vc.p256PublicFromX963(peer));
    },
    copySecret: async () => false, // the helper couldn't mark the clipboard
  };
  return helper;
}

function stub(file: string, exports: object) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

function boot(helper = fakeHelper()) {
  stub("electron", {
    app: { getPath: () => userData, isReady: () => false },
    powerMonitor: { on: () => {}, getSystemIdleTime: () => 0 },
    clipboard: { writeText: (t: string) => clipboardWrites.push(t), readText: () => "", clear: () => {} },
  });
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js")) {
      delete require.cache[key];
    }
  }
  stub("../../bridge/app-init.js", { skipClipboardCapture: () => {} });
  stub("../../bridge/vault/vault-touchid.js", helper);
  const m = {
    helper,
    vault: require("../../bridge/vault/vault-service.js"),
    lifecycle: require("../../bridge/vault/vault-lifecycle.js"),
    controller: require("../../bridge/vault/vault-controller.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    phrase: require("../../bridge/vault/recovery-phrase-pure.js"),
  };
  m.lifecycle.configure({
    Database,
    userData: () => userData,
    notesDir: () => null,
    openDatabases: async () => {},
    closeDatabases: async () => {},
    inbox: () => ({ handlers: {}, loadIdMap: () => new Map() }),
  });
  m.vault.load();
  return m;
}

async function unlockedVault() {
  const m = boot();
  const entropy = crypto.randomBytes(16);
  const { vault: v, masterKey } = m.keys.createVault({ entropy, password: PASSWORD, kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
  return { m, words: m.phrase.entropyToWords(entropy).join(" ") };
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-controller-"));
  clipboardWrites.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("wrong passwords at the lock screen", () => {
  it("wait longer after the third, even for the right password, and reset after an unlock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { m } = await unlockedVault();
    await m.vault.lock();
    for (let i = 0; i < 3; i++) {
      expect(await m.controller.unlockWithPassword("not it at all")).toMatchObject({ success: false, code: "WRONG_PASSWORD" });
    }
    const waiting = await m.controller.unlockWithPassword(PASSWORD);
    expect(waiting).toMatchObject({ success: false, error: "Too many wrong passwords. Try again in 1 second." });
    expect(m.vault.isUnlocked()).toBe(false);

    vi.setSystemTime(Date.now() + 1100);
    expect(await m.controller.unlockWithPassword(PASSWORD)).toEqual({ success: true });
    await m.vault.lock();
    expect(await m.controller.unlockWithPassword("not it at all")).toMatchObject({ code: "WRONG_PASSWORD" });
    expect(await m.controller.unlockWithPassword(PASSWORD)).toEqual({ success: true });
  });
});

describe("recovery phrase while unlocked", () => {
  it("a wrong phrase changes nothing and doesn't lock", async () => {
    const { m } = await unlockedVault();
    const other = m.phrase.entropyToWords(crypto.randomBytes(16)).join(" ");
    const result = await m.controller.recover({ phrase: other, newPassword: "a new password" });
    expect(result).toMatchObject({ success: false, code: "WRONG_PHRASE" });
    expect(m.vault.isUnlocked()).toBe(true);
    expect(() => m.keys.unlockWithPassword(m.vault.getVault(), PASSWORD)).not.toThrow();
  });

  it("the right phrase sets the new password without locking", async () => {
    const { m, words } = await unlockedVault();
    expect(await m.controller.recover({ phrase: words, newPassword: "a new password" })).toEqual({ success: true });
    expect(m.vault.isUnlocked()).toBe(true);
    expect(() => m.keys.unlockWithPassword(m.vault.getVault(), "a new password")).not.toThrow();
  });
});

describe("settings while locked", () => {
  it("can't be changed, not even the ones that look harmless", async () => {
    const { m } = await unlockedVault();
    await m.vault.lock();
    const before = fs.readFileSync(path.join(userData, "vault", "vault.json"), "utf8");
    const result = await m.controller.setPrefs({ lockOnSleep: false, idleMinutes: 0 }, null);
    expect(result).toMatchObject({ success: false, code: "LOCKED" });
    expect(fs.readFileSync(path.join(userData, "vault", "vault.json"), "utf8")).toBe(before);
  });
});

describe("Touch ID", () => {
  it("turning it on needs the password", async () => {
    const { m } = await unlockedVault();
    expect(await m.controller.setTouchIdEnabled(true, null)).toMatchObject({ success: false, code: "INVALID" });
    expect(await m.controller.setTouchIdEnabled(true, { touchId: true })).toMatchObject({ success: false, code: "INVALID" });
    expect(await m.controller.setTouchIdEnabled(true, { password: "not it at all" })).toMatchObject({ code: "WRONG_PASSWORD" });
    expect(m.helper.created).toBe(0);
    expect(await m.controller.setTouchIdEnabled(true, { password: PASSWORD })).toEqual({ success: true });
    expect(m.vault.getVault().touchId).not.toBeNull();
  });

  it("after a fingerprint change, is turned off and stays off after the password unlock", async () => {
    const { m } = await unlockedVault();
    await m.controller.setTouchIdEnabled(true, { password: PASSWORD });
    await m.vault.lock();
    m.helper.invalidated = true;
    const created = m.helper.created;

    expect(await m.controller.unlockWithTouchId()).toMatchObject({ success: false, code: "INVALIDATED" });
    expect(m.vault.getVault().touchId).toBeNull();
    expect(await m.controller.unlockWithPassword(PASSWORD)).toEqual({ success: true });
    expect(m.helper.created).toBe(created); // no new Secure Enclave key behind anyone's back
    expect(m.vault.getVault().touchId).toBeNull();
    expect(m.controller.getStatus().touchIdWasReset).toBe(true);

    m.helper.invalidated = false; // a new key, enrolled with the fingerprints there are now
    expect(await m.controller.setTouchIdEnabled(true, { password: PASSWORD })).toEqual({ success: true });
    expect(m.controller.getStatus().touchIdWasReset).toBe(false);
  });
});

describe("copying the recovery phrase", () => {
  it("fails instead of putting the words on the clipboard unmarked", async () => {
    const m = boot();
    expect(m.controller.beginSetup().success).toBe(true);
    const result = await m.controller.copyPhrase();
    expect(result).toMatchObject({ success: false, error: "Couldn't copy safely. Write the words down instead." });
    expect(clipboardWrites).toEqual([]);
  });
});
