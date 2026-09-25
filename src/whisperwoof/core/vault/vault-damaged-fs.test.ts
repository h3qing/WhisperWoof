/**
 * vault.json missing or unreadable while encrypted data is still on disk:
 * WhisperWoof must stay locked (not fall back to "off" and write plaintext),
 * only the right recovery phrase may rebuild the vault, and the damaged file
 * is moved aside, never overwritten.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const FAST = { N: 1024, r: 8, p: 1 };
let userData = "";

function boot() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userData, isReady: () => false } },
  } as unknown as NodeJS.Module;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js")) {
      delete require.cache[key];
    }
  }
  return {
    vault: require("../../bridge/vault/vault-service.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    files: require("../../bridge/vault/vault-files.js"),
    migrate: require("../../bridge/vault/vault-migrate.js"),
  };
}

async function encryptedInstall() {
  const m = boot();
  const db = new Database(path.join(userData, "transcriptions.db"));
  db.exec("CREATE TABLE t (x TEXT)");
  db.close();
  fs.writeFileSync(path.join(userData, "whisperwoof-style-examples.json"), JSON.stringify([{ polished: "secret" }]));
  const entropy = crypto.randomBytes(16);
  const { vault: v, masterKey } = m.keys.createVault({ entropy, password: "a good password", kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
  await m.migrate.run("enable", { Database, userData, notesDir: null, sealNotes: true });
  await m.vault.lock();
  return entropy;
}

const vaultDir = () => path.join(userData, "vault");

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-damaged-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("vault.json gone or damaged", () => {
  it("stays locked when vault.json is deleted but encrypted data remains", async () => {
    await encryptedInstall();
    fs.rmSync(path.join(vaultDir(), "vault.json"));
    fs.rmSync(path.join(vaultDir(), "vault.json.bak"));
    const m = boot();
    expect(m.vault.load()).toBe("locked");
    expect(m.vault.isDamaged()).toBe(true);
  });

  it("doesn't overwrite a sealed store with plaintext when encryption looks off", async () => {
    await encryptedInstall();
    fs.rmSync(vaultDir(), { recursive: true });
    const m = boot();
    m.vault.load();
    const store = path.join(userData, "whisperwoof-style-examples.json");
    expect(() => m.files.writeJson(store, [], { requireUnlocked: true })).toThrow();
    expect(fs.existsSync(store + ".wwenc")).toBe(true);
  });

  it("rejects a valid-looking phrase that isn't this vault's, and keeps the damaged file", async () => {
    await encryptedInstall();
    fs.writeFileSync(path.join(vaultDir(), "vault.json"), "{ damaged");
    fs.writeFileSync(path.join(vaultDir(), "vault.json.bak"), "{ damaged too");
    const m = boot();
    m.vault.load();
    await expect(m.vault.unlockWithEntropy(crypto.randomBytes(16), "new password 1")).rejects.toThrow(m.keys.WrongPhraseError);
    expect(fs.readFileSync(path.join(vaultDir(), "vault.json"), "utf8")).toBe("{ damaged");
    expect(m.vault.isUnlocked()).toBe(false);
  });

  it("rebuilds the vault from the right phrase and moves the damaged file aside", async () => {
    const entropy = await encryptedInstall();
    fs.writeFileSync(path.join(vaultDir(), "vault.json"), "{ damaged");
    fs.writeFileSync(path.join(vaultDir(), "vault.json.bak"), "{ damaged too");
    const m = boot();
    m.vault.load();
    await m.vault.unlockWithEntropy(entropy, "new password 1");
    expect(m.vault.isUnlocked()).toBe(true);
    expect(m.files.readJson(path.join(userData, "whisperwoof-style-examples.json"), null)).toEqual([{ polished: "secret" }]);
    expect(fs.readdirSync(vaultDir()).some((n) => n.startsWith("vault.json.damaged-"))).toBe(true);
    const again = boot();
    again.vault.load();
    await again.vault.unlockWithPassword("new password 1");
    expect(again.vault.isUnlocked()).toBe(true);
  });
});

describe("scrypt settings from a vault file", () => {
  it("refuses costs high enough to hang the app", () => {
    const vc = require("../../bridge/vault/vault-crypto-pure.js");
    expect(() => vc.assertScryptParams({ N: 2 ** 22, r: 8, p: 1 })).toThrow();
    expect(() => vc.assertScryptParams({ N: 2 ** 18, r: 64, p: 1 })).toThrow();
    expect(() => vc.assertScryptParams({ N: 2 ** 18, r: 8, p: 64 })).toThrow();
    expect(() => vc.assertScryptParams({ N: 2 ** 18, r: 8, p: 1 })).not.toThrow();
  });
});
