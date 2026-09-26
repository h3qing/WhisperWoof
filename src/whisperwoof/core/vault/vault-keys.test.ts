import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const vk = require("../../bridge/vault/vault-keys-pure.js");
const vc = require("../../bridge/vault/vault-crypto-pure.js");

const FAST = { N: 1024, r: 8, p: 1 };
const make = (password = "correct horse battery") => {
  const entropy = crypto.randomBytes(16);
  const { vault, masterKey } = vk.createVault({ entropy, password, kdf: FAST });
  return { entropy, vault, masterKey };
};

describe("createVault", () => {
  it("returns a 32-byte master key and a vault that holds no secret in the clear", () => {
    const { vault, masterKey, entropy } = make();
    expect(masterKey).toHaveLength(32);
    const json = JSON.stringify(vault);
    expect(json).not.toContain(masterKey.toString("hex"));
    expect(json).not.toContain(masterKey.toString("base64"));
    expect(json).not.toContain(entropy.toString("hex"));
    expect(vault.version).toBe(1);
    expect(vault.touchId).toBeNull();
  });

  it("derives the master key from the phrase entropy alone", () => {
    const { vault, masterKey, entropy } = make();
    expect(vk.masterKeyFromEntropy(entropy).equals(masterKey)).toBe(true);
    expect(vk.masterKeyFromEntropy(entropy, vault).equals(masterKey)).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(() => vk.createVault({ entropy: crypto.randomBytes(16), password: "short", kdf: FAST })).toThrow(/8/);
  });

  it("starts with the approved defaults", () => {
    const { vault } = make();
    expect(vault.prefs).toEqual({ touchId: false, lockOnSleep: true, idleMinutes: 0, notesReadable: false });
  });
});

describe("unlockWithPassword", () => {
  it("returns the master key for the right password", () => {
    const { vault, masterKey } = make("correct horse battery");
    expect(vk.unlockWithPassword(vault, "correct horse battery").equals(masterKey)).toBe(true);
  });

  it("throws WrongPasswordError for the wrong password", () => {
    const { vault } = make("correct horse battery");
    expect(() => vk.unlockWithPassword(vault, "correct horse batterY")).toThrow(vk.WrongPasswordError);
  });

  it("can't be moved to another vault (AAD binds the vault id)", () => {
    const a = make("same password!");
    const b = make("same password!");
    const franken = { ...b.vault, password: a.vault.password };
    expect(() => vk.unlockWithPassword(franken, "same password!")).toThrow(vk.WrongPasswordError);
  });
});

describe("masterKeyFromEntropy with a vault", () => {
  it("throws WrongPhraseError for a phrase from another vault", () => {
    const { vault } = make();
    expect(() => vk.masterKeyFromEntropy(crypto.randomBytes(16), vault)).toThrow(vk.WrongPhraseError);
  });
});

describe("setPassword", () => {
  it("makes the new password work and the old one fail, without changing the master key", () => {
    const { vault, masterKey } = make("old password 1");
    const next = vk.setPassword(vault, masterKey, "new password 2", FAST);
    expect(vk.unlockWithPassword(next, "new password 2").equals(masterKey)).toBe(true);
    expect(() => vk.unlockWithPassword(next, "old password 1")).toThrow(vk.WrongPasswordError);
  });

  it("does not mutate the vault it was given", () => {
    const { vault, masterKey } = make("old password 1");
    const before = JSON.stringify(vault);
    vk.setPassword(vault, masterKey, "new password 2", FAST);
    expect(JSON.stringify(vault)).toBe(before);
  });

  it("refuses a master key that doesn't belong to the vault", () => {
    const { vault } = make();
    expect(() => vk.setPassword(vault, crypto.randomBytes(32), "new password 2", FAST)).toThrow();
  });
});

describe("Touch ID wrap (Secure Enclave simulated with a software P-256 key)", () => {
  const enclave = () => {
    const key = vc.p256Generate();
    return { pub: key.publicX963, ecdh: (peerX963: Buffer) => vc.p256Shared(key.privateKey, vc.p256PublicFromX963(peerX963)) };
  };

  it("unwraps the master key from the enclave's ECDH secret", () => {
    const { vault, masterKey } = make();
    const se = enclave();
    const withTid = vk.setTouchIdWrap(vault, masterKey, { publicKey: se.pub, keyBlob: Buffer.from("blob") });
    const peer = vk.touchIdPeerPublic(withTid);
    expect(vk.unlockWithTouchIdSecret(withTid, se.ecdh(peer)).equals(masterKey)).toBe(true);
    expect(withTid.prefs.touchId).toBe(true);
    expect(vk.touchIdKeyBlob(withTid).toString()).toBe("blob");
  });

  it("fails with a different enclave key", () => {
    const { vault, masterKey } = make();
    const withTid = vk.setTouchIdWrap(vault, masterKey, { publicKey: enclave().pub, keyBlob: Buffer.from("b") });
    const other = enclave();
    expect(() => vk.unlockWithTouchIdSecret(withTid, other.ecdh(vk.touchIdPeerPublic(withTid)))).toThrow();
  });

  it("clearTouchId removes the wrap and turns the pref off", () => {
    const { vault, masterKey } = make();
    const withTid = vk.setTouchIdWrap(vault, masterKey, { publicKey: enclave().pub, keyBlob: Buffer.from("b") });
    const cleared = vk.clearTouchId(withTid);
    expect(cleared.touchId).toBeNull();
    expect(cleared.prefs.touchId).toBe(false);
  });
});

describe("derived keys", () => {
  it("gives a 64-hex SQLCipher key and the vault's sealing key pair", () => {
    const { vault, masterKey } = make();
    const keys = vk.deriveKeys(masterKey);
    expect(keys.dbKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.sealPublicRaw.toString("base64")).toBe(vault.sealPublicKey);
    expect(vk.sealPublicKey(vault).equals(keys.sealPublicRaw)).toBe(true);
  });

  it("verifySealKey catches a swapped public key", () => {
    const { vault, masterKey } = make();
    expect(vk.verifySealKey(vault, masterKey)).toBe(true);
    const swapped = { ...vault, sealPublicKey: crypto.randomBytes(32).toString("base64") };
    expect(vk.verifySealKey(swapped, masterKey)).toBe(false);
  });
});

describe("parseVault", () => {
  it("round-trips a created vault through JSON", () => {
    const { vault } = make();
    expect(vk.parseVault(JSON.parse(JSON.stringify(vault)))).toEqual(vault);
  });

  it("rejects other versions, missing fields and cheap password settings", () => {
    const { vault } = make();
    expect(() => vk.parseVault({ ...vault, version: 2 })).toThrow();
    expect(() => vk.parseVault({ ...vault, sealPublicKey: undefined })).toThrow();
    const cheap = { ...vault, password: { ...vault.password, kdf: { name: "scrypt", N: 16, r: 8, p: 1 } } };
    expect(() => vk.parseVault(cheap)).toThrow();
  });
});

describe("updatePrefs", () => {
  it("accepts known prefs and ignores the rest", () => {
    const { vault } = make();
    const next = vk.updatePrefs(vault, { lockOnSleep: false, idleMinutes: 15, notesReadable: true, evil: 1 });
    expect(next.prefs).toEqual({ touchId: false, lockOnSleep: false, idleMinutes: 15, notesReadable: true });
    expect(vault.prefs.lockOnSleep).toBe(true);
  });

  it("only allows the offered idle choices", () => {
    const { vault } = make();
    expect(vk.updatePrefs(vault, { idleMinutes: 7 }).prefs.idleMinutes).toBe(0);
    expect(vk.updatePrefs(vault, { idleMinutes: 60 }).prefs.idleMinutes).toBe(60);
  });

  it("never turns Touch ID on (that needs an enrolled key)", () => {
    const { vault } = make();
    expect(vk.updatePrefs(vault, { touchId: true }).prefs.touchId).toBe(false);
  });
});
