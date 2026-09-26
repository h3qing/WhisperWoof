/**
 * New recovery phrase: everything moves to a new master key; the old phrase
 * stops working, the password keeps working, and a crash mid-way resumes on
 * the next unlock. Real SQLCipher database, real files.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const PASSWORD = "a good password";
const FAST = { N: 1024, r: 8, p: 1 };

let userData = "";
let notesDir = "";

function boot() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => userData, isReady: () => false },
      powerMonitor: { on: () => {}, getSystemIdleTime: () => 0 },
    },
  } as unknown as NodeJS.Module;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js")) {
      delete require.cache[key];
    }
  }
  const m = {
    vault: require("../../bridge/vault/vault-service.js"),
    lifecycle: require("../../bridge/vault/vault-lifecycle.js"),
    rotation: require("../../bridge/vault/vault-rotate.js"),
    files: require("../../bridge/vault/vault-files.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    inbox: require("../../bridge/vault/vault-inbox.js"),
    db: require("../../bridge/vault/vault-db.js"),
    migrate: require("../../bridge/vault/vault-migrate.js"),
  };
  m.lifecycle.configure({
    Database,
    userData: () => userData,
    notesDir: () => notesDir,
    openDatabases: async () => {},
    closeDatabases: async () => {},
    inboxHandlers: () => ({}),
  });
  m.vault.load();
  return m;
}

async function encryptedSetup() {
  const m = boot();
  const db = new Database(path.join(userData, "transcriptions.db"));
  db.exec("CREATE TABLE t (x TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("hello");
  db.close();
  fs.mkdirSync(path.join(userData, "audio"));
  fs.writeFileSync(path.join(userData, "audio", "a.webm"), crypto.randomBytes(150000));
  fs.writeFileSync(path.join(notesDir, "2026-09-25-101500.md"), "---\ntitle: \"n\"\n---\nnote\n");
  const oldEntropy = crypto.randomBytes(16);
  const { vault: v, masterKey } = m.keys.createVault({ entropy: oldEntropy, password: PASSWORD, kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
  await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: true });
  m.inbox.record("entry.save", { entry: { id: "while-locked" } });
  return { m, oldEntropy, audio: fs.readFileSync(path.join(userData, "audio", "a.webm.wwenc")) };
}

function expectEverythingOpens(m: ReturnType<typeof boot>) {
  const db = m.db.openDatabase(Database, path.join(userData, "transcriptions.db"));
  expect(db.prepare("SELECT x FROM t").get().x).toBe("hello");
  db.close();
  expect(m.files.readFile(path.join(userData, "audio", "a.webm"))).toHaveLength(150000);
  expect(m.files.readText(path.join(notesDir, "2026-09-25-101500.md"))).toContain("note");
  expect(m.inbox.count()).toBe(1);
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-rot-ud-"));
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-rot-notes-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("new recovery phrase", () => {
  it("moves everything to the new key; the old phrase stops working, the password doesn't", async () => {
    const { m, oldEntropy, audio } = await encryptedSetup();
    const newEntropy = crypto.randomBytes(16);
    m.rotation.rememberPassword(PASSWORD);
    await m.rotation.rotate(newEntropy);

    const v = m.vault.getVault();
    expect(() => m.keys.masterKeyFromEntropy(oldEntropy, v)).toThrow(m.keys.WrongPhraseError);
    expect(m.keys.masterKeyFromEntropy(newEntropy, v)).toHaveLength(32);
    expect(m.keys.unlockWithPassword(v, PASSWORD)).toHaveLength(32);
    expectEverythingOpens(m);

    // Only the header changed: the body bytes of the audio file are identical.
    const after = fs.readFileSync(path.join(userData, "audio", "a.webm.wwenc"));
    expect(after.subarray(after.length - 1000).equals(audio.subarray(audio.length - 1000))).toBe(true);
    expect(fs.existsSync(path.join(userData, "vault", "vault.next.json"))).toBe(false);
    expect(fs.existsSync(path.join(userData, "vault", "migration.json"))).toBe(false);

    // After a restart, the new vault unlocks with the password and opens everything.
    const again = boot();
    await again.vault.unlockWithPassword(PASSWORD);
    expectEverythingOpens(again);
  });

  it("keeps each file's modified time", async () => {
    const { m } = await encryptedSetup();
    const audio = path.join(userData, "audio", "a.webm.wwenc");
    const old = new Date("2026-09-01T10:00:00Z");
    fs.utimesSync(audio, old, old);
    m.rotation.rememberPassword(PASSWORD);
    await m.rotation.rotate(crypto.randomBytes(16));
    expect(fs.statSync(audio).mtimeMs).toBe(old.getTime());
  });

  it("resumes after a crash half-way through, on the next unlock", async () => {
    const { m } = await encryptedSetup();
    const newEntropy = crypto.randomBytes(16);
    m.rotation.rememberPassword(PASSWORD);
    // Crash while re-wrapping files: the database is already on the new key.
    m.rotation.configure({
      Database,
      userData: () => userData,
      notesDir: () => notesDir,
      closeDatabases: async () => {},
      onProgress: (p: { phase: string } | null) => {
        if (p && p.phase === "files") throw new Error("power cut");
      },
    });
    await expect(m.rotation.rotate(newEntropy)).rejects.toThrow("power cut");
    expect(fs.existsSync(path.join(userData, "vault", "vault.next.json"))).toBe(true);

    const restarted = boot();
    expect(restarted.vault.status()).toBe("locked");
    await restarted.vault.unlockWithPassword(PASSWORD); // old vault.json; the unlock finishes the rotation
    expect(fs.existsSync(path.join(userData, "vault", "vault.next.json"))).toBe(false);
    expect(restarted.keys.masterKeyFromEntropy(newEntropy, restarted.vault.getVault())).toHaveLength(32);
    expectEverythingOpens(restarted);
  });

  it("skips a note sealed by another Mac's vault instead of failing", async () => {
    const { m, oldEntropy } = await encryptedSetup();
    const ww = require("../../bridge/vault/wwenc-pure.js");
    const vc = require("../../bridge/vault/vault-crypto-pure.js");
    const foreign = path.join(notesDir, "2026-09-20-090000.md.wwenc");
    const other = vc.x25519FromSeed(crypto.randomBytes(32));
    fs.writeFileSync(foreign, ww.encrypt(Buffer.from("someone else's note"), other.publicRaw, { kind: "note" }));
    const before = fs.readFileSync(foreign);
    m.rotation.rememberPassword(PASSWORD);
    await m.rotation.rotate(crypto.randomBytes(16));
    expect(fs.readFileSync(foreign).equals(before)).toBe(true);
    expect(() => m.keys.masterKeyFromEntropy(oldEntropy, m.vault.getVault())).toThrow();
    expectEverythingOpens(m);
  });

  it("keeps everything readable in the same session when it stops half-way", async () => {
    const { m } = await encryptedSetup();
    m.rotation.rememberPassword(PASSWORD);
    m.rotation.configure({
      Database,
      userData: () => userData,
      notesDir: () => notesDir,
      closeDatabases: async () => {},
      openDatabases: async () => {},
      onProgress: (p: { phase: string } | null) => {
        if (p && p.phase === "db") throw new Error("disk full");
      },
    });
    await expect(m.rotation.rotate(crypto.randomBytes(16))).rejects.toThrow("disk full");
    // Files are already on the new key, vault.json is still the old one: both keys work.
    expectEverythingOpens(m);
  });

  it("finishes cleanly after a crash between adopting the new vault and deleting the leftovers", async () => {
    const { m } = await encryptedSetup();
    const newEntropy = crypto.randomBytes(16);
    m.rotation.rememberPassword(PASSWORD);
    await m.rotation.rotate(newEntropy);
    // Put back what a crash right after adopting would have left behind.
    const next = { vault: m.vault.getVault(), link: { nonce: "AAAAAAAAAAAAAAAA", ct: "AAAA" } };
    fs.writeFileSync(path.join(userData, "vault", "vault.next.json"), JSON.stringify(next));
    fs.writeFileSync(path.join(userData, "vault", "migration.json"), JSON.stringify({ v: 1, direction: "rotate", startedAt: new Date().toISOString(), phase: "db" }));
    const restarted = boot();
    await restarted.vault.unlockWithPassword(PASSWORD);
    expect(fs.existsSync(path.join(userData, "vault", "vault.next.json"))).toBe(false);
    expect(fs.existsSync(path.join(userData, "vault", "migration.json"))).toBe(false);
    expectEverythingOpens(restarted);
  });

  it("deletes a leftover vault.next.json at startup when no rotation is running", async () => {
    const { m } = await encryptedSetup();
    fs.writeFileSync(path.join(userData, "vault", "vault.next.json"), JSON.stringify({ vault: m.vault.getVault(), link: {} }));
    boot();
    expect(fs.existsSync(path.join(userData, "vault", "vault.next.json"))).toBe(false);
  });

  it("refuses to start without the password confirmed first", async () => {
    const { m } = await encryptedSetup();
    await expect(m.rotation.rotate(crypto.randomBytes(16))).rejects.toThrow(/Start again/);
  });
});
