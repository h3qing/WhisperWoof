/**
 * Turning encryption on through the controller, as the Encryption settings do:
 * Touch ID is checked before anything is encrypted, and a lock asked for while
 * the data is being encrypted waits for it to finish. Touch ID is a fake
 * Secure Enclave doing real P-256 ECDH, so the unlock math is the real one.
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

let userData = "";
let notesDir = "";
let touchIdMode: "ok" | "cancel" = "ok";
let atPrompt: { dbPlain: boolean; vaultExists: boolean; reason: string } | null = null;
let replayed: string[] = [];

const dbFile = () => path.join(userData, "transcriptions.db");
const dbIsPlain = () => fs.readFileSync(dbFile()).subarray(0, 15).toString() === "SQLite format 3";

const fakeTouchId = {
  getAvailability: async () => ({ available: true }),
  createKey: async () => {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    return { publicKey: ecdh.getPublicKey(), keyBlob: ecdh.getPrivateKey() };
  },
  deriveSecret: async ({ keyBlob, peer, reason }: { keyBlob: Buffer; peer: Buffer; reason: string }) => {
    atPrompt = { dbPlain: dbIsPlain(), vaultExists: fs.existsSync(path.join(userData, "vault", "vault.json")), reason };
    if (touchIdMode === "cancel") throw Object.assign(new Error("Touch ID was cancelled"), { code: "CANCELLED" });
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(keyBlob);
    return ecdh.computeSecret(peer);
  },
  copySecret: async () => false,
};

function boot() {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => userData, isReady: () => false },
      powerMonitor: { on() {}, getSystemIdleTime: () => 0 },
    },
  } as unknown as NodeJS.Module;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js")) {
      delete require.cache[key];
    }
  }
  const touchIdPath = require.resolve("../../bridge/vault/vault-touchid.js");
  require.cache[touchIdPath] = { id: touchIdPath, filename: touchIdPath, loaded: true, exports: fakeTouchId } as unknown as NodeJS.Module;
  const m = {
    vault: require("../../bridge/vault/vault-service.js"),
    lifecycle: require("../../bridge/vault/vault-lifecycle.js"),
    controller: require("../../bridge/vault/vault-controller.js"),
    inbox: require("../../bridge/vault/vault-inbox.js"),
    files: require("../../bridge/vault/vault-files.js"),
  };
  m.lifecycle.configure({
    Database,
    userData: () => userData,
    notesDir: () => notesDir,
    openDatabases: async () => {},
    closeDatabases: async () => {},
    inbox: () => ({
      handlers: {
        "entry.save": async (data: { entry: { id: string } }) => void replayed.push(data.entry.id),
        // Like the real handler: Memory is rewritten, encrypted while encryption is on.
        "vocab.correction": async (data: { word: string }) =>
          m.files.writeJson(path.join(userData, "whisperwoof-vocabulary.json"), [{ word: data.word }]),
      },
      loadIdMap: () => ({}),
    }),
  });
  return m;
}

function seed() {
  const db = new Database(dbFile());
  db.exec("CREATE TABLE t (x TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("hello");
  db.close();
  const images = path.join(userData, "whisperwoof-images");
  fs.mkdirSync(images);
  for (let i = 0; i < 150; i++) fs.writeFileSync(path.join(images, `img-${i}.png`), crypto.randomBytes(2000));
}

async function turnOn(m: ReturnType<typeof boot>, useTouchId: boolean) {
  const begun = m.controller.beginSetup();
  const confirmWords = Object.fromEntries(begun.confirmIndexes.map((i: number) => [i, begun.words[i]]));
  return { begun, result: await m.controller.completeSetup({ password: PASSWORD, confirmWords, useTouchId, notesReadable: false }) };
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-setup-ud-"));
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-setup-notes-"));
  touchIdMode = "ok";
  atPrompt = null;
  replayed = [];
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("turning encryption on with Touch ID", () => {
  it("checks Touch ID works before anything is encrypted", async () => {
    const m = boot();
    seed();
    const { result } = await turnOn(m, true);
    expect(result).toEqual({ success: true });
    expect(atPrompt).toMatchObject({ dbPlain: true, vaultExists: false });
    expect(atPrompt?.reason).toMatch(/before encrypting/);
    expect(m.vault.getPrefs().touchId).toBe(true);
    expect(dbIsPlain()).toBe(false);
  });

  it("encrypts nothing when the Touch ID check fails, and keeps the recovery phrase for a retry", async () => {
    const m = boot();
    seed();
    touchIdMode = "cancel";
    const { begun, result } = await turnOn(m, true);
    expect(result).toMatchObject({ success: false, code: "CANCELLED" });
    expect(m.vault.isOn()).toBe(false);
    expect(dbIsPlain()).toBe(true);
    expect(fs.existsSync(path.join(userData, "whisperwoof-images", "img-0.png"))).toBe(true);

    touchIdMode = "ok";
    const confirmWords = Object.fromEntries(begun.confirmIndexes.map((i: number) => [i, begun.words[i]]));
    const retried = await m.controller.completeSetup({ password: PASSWORD, confirmWords, useTouchId: true, notesReadable: false });
    expect(retried).toEqual({ success: true });
    expect(m.vault.isOn()).toBe(true);
  });
});

describe("locking while your data is being encrypted", () => {
  it("waits until encrypting finishes, then locks", async () => {
    const m = boot();
    seed();
    let duringLock: unknown = null;
    setImmediate(() => {
      m.vault.lock().then((r: unknown) => {
        duringLock = r;
      });
    });
    const { result } = await turnOn(m, false);
    expect(result).toEqual({ success: true });
    expect(duringLock).toEqual({ locked: false, deferred: true });
    expect(m.vault.isUnlocked()).toBe(false);
    expect(dbIsPlain()).toBe(false);
  });
});

describe("while files are being converted", () => {
  it("turning encryption off keeps what was saved sealed meanwhile, and the next start isn't locked", async () => {
    const m = boot();
    seed();
    await turnOn(m, false);
    setImmediate(() => m.inbox.record("entry.save", { entry: { id: "saved-while-turning-off" } }));
    const off = await m.controller.disable({ password: PASSWORD });
    expect(off).toEqual({ success: true });
    expect(replayed).toContain("saved-while-turning-off");
    expect(m.vault.isOn()).toBe(false);
    const inboxDir = path.join(userData, "vault", "inbox");
    expect(fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir) : []).toEqual([]);

    const again = boot();
    again.vault.load();
    expect(again.vault.status()).toBe("off");
  });

  it("turning encryption off leaves what it brings in from the inbox plain, not encrypted", async () => {
    const m = boot();
    seed();
    await turnOn(m, false);
    setImmediate(() => m.inbox.record("vocab.correction", { word: "Mando" }));
    expect(await m.controller.disable({ password: PASSWORD })).toEqual({ success: true });
    const vocab = path.join(userData, "whisperwoof-vocabulary.json");
    expect(JSON.parse(fs.readFileSync(vocab, "utf8"))).toEqual([{ word: "Mando" }]);
    const sealedLeft: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".wwenc")) sealedLeft.push(p);
      }
    };
    walk(userData);
    expect(sealedLeft).toEqual([]);
    expect(fs.existsSync(path.join(userData, "vault", "migration.json"))).toBe(false);

    const again = boot();
    again.vault.load();
    expect(again.vault.status()).toBe("off");
  });

  it("a lock asked for while unlocking waits until every unlock step has run", async () => {
    const m = boot();
    seed();
    await turnOn(m, false);
    // Leave a half-done migration for the next unlock to finish.
    fs.writeFileSync(path.join(userData, "whisperwoof-images", "late.png"), crypto.randomBytes(2000));
    fs.writeFileSync(path.join(userData, "vault", "migration.json"), JSON.stringify({ v: 1, direction: "enable", startedAt: new Date().toISOString(), phase: "files" }));
    await m.vault.lock({ force: true });
    let unlockedInLastStep: boolean | null = null;
    m.vault.onUnlocked(async () => {
      unlockedInLastStep = m.vault.isUnlocked();
    });
    setImmediate(() => void m.vault.lock());
    const unlocked = await m.controller.unlockWithPassword(PASSWORD);
    expect(unlocked).toEqual({ success: true });
    expect(unlockedInLastStep).toBe(true);
    expect(m.vault.isUnlocked()).toBe(false);
    expect(fs.existsSync(path.join(userData, "whisperwoof-images", "late.png.wwenc"))).toBe(true);
  });

  it("while something that stopped is waiting to be finished, only Try again (or turning off) runs", async () => {
    const m = boot();
    seed();
    await turnOn(m, false);
    const journal = path.join(userData, "vault", "migration.json");
    fs.writeFileSync(journal, JSON.stringify({ v: 1, direction: "disable", startedAt: new Date().toISOString(), phase: "db" }));
    const begun = await m.controller.beginNewPhrase({ password: PASSWORD });
    const confirmWords = Object.fromEntries(begun.confirmIndexes.map((i: number) => [i, begun.words[i]]));
    expect(await m.controller.completeNewPhrase({ confirmWords })).toMatchObject({ success: false, code: "BUSY" });
    expect(JSON.parse(fs.readFileSync(journal, "utf8")).direction).toBe("disable");
    expect(await m.controller.retry()).toEqual({ success: true });
    expect(m.vault.isOn()).toBe(false);
    expect(dbIsPlain()).toBe(true);
  });

  it("won't change the password until converting is done", async () => {
    const m = boot();
    seed();
    await turnOn(m, false);
    let during: unknown = null;
    setImmediate(() => {
      m.controller.changePassword({ currentPassword: PASSWORD, newPassword: "another good password" }).then((r: unknown) => {
        during = r;
      });
    });
    await m.controller.disable({ password: PASSWORD });
    expect(during).toMatchObject({ success: false, code: "BUSY" });
  });
});
