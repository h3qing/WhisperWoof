/**
 * Someone who can write WhisperWoof's folders while it's locked (the first
 * attacker in the design's threat model) plants or edits files, then waits for
 * the user to unlock. Real SQLCipher database, real files, the real unlock
 * steps (vault-lifecycle).
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
const SECRET = "zebra-quartz-secret";

let userData = "";
let notesDir = "";
let imported: string[] = [];

function boot({ withLifecycle = true } = {}) {
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
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || /(debugLogger|app-files)\.js$/.test(key)) {
      delete require.cache[key];
    }
  }
  const m = {
    vault: require("../../bridge/vault/vault-service.js"),
    lifecycle: require("../../bridge/vault/vault-lifecycle.js"),
    files: require("../../bridge/vault/vault-files.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    plan: require("../../bridge/vault/migration-plan-pure.js"),
    journal: require("../../bridge/vault/vault-journal.js"),
    inbox: require("../../bridge/vault/vault-inbox.js"),
    db: require("../../bridge/vault/vault-db.js"),
    ww: require("../../bridge/vault/wwenc-pure.js"),
  };
  if (withLifecycle) {
    m.lifecycle.configure({
      Database,
      userData: () => userData,
      notesDir: () => notesDir,
      openDatabases: async () => {},
      closeDatabases: async () => {},
      inbox: () => ({
        handlers: {
          "entry.save": (data: { entry: { id: string } }) => {
            imported.push(data.entry.id);
          },
        },
        loadIdMap: () => new Map(),
      }),
    });
  }
  m.vault.load();
  return m;
}

type M = ReturnType<typeof boot>;

const dbFile = () => path.join(userData, "transcriptions.db");
const audio = () => path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm");
const vocab = () => path.join(userData, "whisperwoof-vocabulary.json");
const note = () => path.join(notesDir, "2026-09-25-101500.md");
const vaultDir = () => path.join(userData, "vault");
const journalFile = () => path.join(vaultDir(), "migration.json");

function seedPlain() {
  const db = new Database(dbFile());
  db.exec("CREATE TABLE t (x TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run(`row ${SECRET}`);
  db.close();
  fs.mkdirSync(path.join(userData, "audio"));
  fs.writeFileSync(audio(), `voice ${SECRET}`);
  fs.writeFileSync(vocab(), JSON.stringify([{ word: SECRET }]));
  fs.writeFileSync(note(), `---\ntitle: "n"\n---\nnote ${SECRET}\n`);
}

/** Turn encryption on the way completeSetup does: vault.json, signed journal, unlock (which migrates). */
async function turnOn(m: M, prefs: object = {}) {
  const created = m.keys.createVault({ entropy: crypto.randomBytes(16), password: PASSWORD, kdf: FAST });
  const v = m.keys.updatePrefs(created.vault, prefs);
  await m.vault.adoptNewVault(v, created.masterKey, {
    beforeUnlock: () =>
      m.journal.write(m.plan.startJournal("enable"), { masterKey: created.masterKey, vaultId: v.vaultId }),
  });
}

/** An encrypted install, locked, as a restart would find it. */
async function lockedInstall(prefs: object = {}) {
  seedPlain();
  const m = boot();
  await turnOn(m, prefs);
  await m.vault.lock();
  return m;
}

function isEncryptedOnDisk() {
  const head = fs.readFileSync(dbFile()).subarray(0, 16);
  return !head.equals(Buffer.from("SQLite format 3\0", "latin1"));
}

function editVaultJson(edit: (json: Record<string, unknown>) => Record<string, unknown>) {
  for (const name of ["vault.json", "vault.json.bak"]) {
    const file = path.join(vaultDir(), name);
    fs.writeFileSync(file, JSON.stringify(edit(JSON.parse(fs.readFileSync(file, "utf8")))));
  }
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-tamper-ud-"));
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-tamper-notes-"));
  imported = [];
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("a migration journal planted while locked", () => {
  const plant = (phase: string) =>
    fs.writeFileSync(journalFile(), JSON.stringify({ v: 1, direction: "disable", phase, startedAt: new Date().toISOString() }));

  it("doesn't turn encryption off at the next unlock", async () => {
    await lockedInstall();
    plant("files");
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);

    expect(m.vault.status()).toBe("unlocked");
    expect(isEncryptedOnDisk()).toBe(true);
    expect(fs.existsSync(`${audio()}.wwenc`)).toBe(true);
    expect(fs.existsSync(audio())).toBe(false);
    expect(fs.existsSync(journalFile())).toBe(false);
    expect(m.vault.getWarnings()).toEqual(["journal"]);
  });

  it("at phase \"done\" doesn't forget the vault (which would leave the data unopenable)", async () => {
    await lockedInstall();
    plant("done");
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);

    expect(m.vault.status()).toBe("unlocked");
    expect(fs.existsSync(path.join(vaultDir(), "vault.json"))).toBe(true);
    expect(m.files.readText(audio())).toBe(`voice ${SECRET}`);
    // A fresh start still unlocks: nothing was lost.
    const again = boot();
    await again.vault.unlockWithPassword(PASSWORD);
    expect(again.vault.isUnlocked()).toBe(true);
  });

  it("signed by another vault's key is just as ignored", async () => {
    await lockedInstall();
    const other = crypto.randomBytes(32);
    const vaultId = JSON.parse(fs.readFileSync(path.join(vaultDir(), "vault.json"), "utf8")).vaultId;
    const m0 = boot();
    fs.writeFileSync(journalFile(), JSON.stringify(m0.plan.signJournal(m0.plan.startJournal("disable"), other, vaultId)));
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);
    expect(m.vault.status()).toBe("unlocked");
    expect(fs.existsSync(`${audio()}.wwenc`)).toBe(true);
  });

  it("isn't enough to open a planted plain database", async () => {
    await lockedInstall();
    plant("db");
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);
    fs.rmSync(dbFile());
    new Database(dbFile()).exec("CREATE TABLE planted (x TEXT)");
    plant("db");
    expect(() => m.db.openDatabase(Database, dbFile())).toThrow();
  });
});

describe("interrupted migrations still resume", () => {
  it("turning on, after a crash right after the journal was written", async () => {
    seedPlain();
    const first = boot({ withLifecycle: false }); // the crash: nothing ran after the unlock
    await turnOn(first);
    expect(isEncryptedOnDisk()).toBe(false);
    expect(fs.existsSync(journalFile())).toBe(true);

    const m = boot();
    expect(m.vault.status()).toBe("locked");
    await m.vault.unlockWithPassword(PASSWORD);
    expect(isEncryptedOnDisk()).toBe(true);
    expect(fs.existsSync(audio())).toBe(false);
    expect(m.files.readText(audio())).toBe(`voice ${SECRET}`);
    expect(fs.existsSync(journalFile())).toBe(false);
    expect(m.vault.getWarnings()).toEqual([]);
  });

  it("turning off, importing what was sealed meanwhile before the vault is forgotten", async () => {
    await lockedInstall();
    const before = boot();
    await before.vault.unlockWithPassword(PASSWORD);
    before.inbox.record("entry.save", { entry: { id: "saved-while-converting" } });
    before.journal.write(before.plan.startJournal("disable")); // controller.disable, then a crash

    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);

    expect(m.vault.status()).toBe("off");
    expect(imported).toEqual(["saved-while-converting"]);
    expect(isEncryptedOnDisk()).toBe(false);
    expect(fs.readFileSync(audio(), "utf8")).toBe(`voice ${SECRET}`);
    expect(fs.readFileSync(note(), "utf8")).toContain(SECRET);
    expect(fs.existsSync(path.join(vaultDir(), "vault.json"))).toBe(false);
    expect(fs.existsSync(journalFile())).toBe(false);
  });

  it("turning off keeps the vault while something is still sealed", async () => {
    await lockedInstall();
    const before = boot();
    await before.vault.unlockWithPassword(PASSWORD);
    // A recording sealed to some other key: it can't be decrypted, so the vault must stay.
    const stranger = require("../../bridge/vault/vault-crypto-pure.js").x25519FromSeed(crypto.randomBytes(32));
    fs.writeFileSync(path.join(userData, "audio", "odd.webm.wwenc"), before.ww.encrypt(Buffer.from("?"), stranger.publicRaw, { kind: "audio" }));
    before.journal.write({ ...before.plan.startJournal("disable"), phase: "done" });

    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);
    expect(m.vault.status()).toBe("unlocked");
    expect(fs.existsSync(path.join(vaultDir(), "vault.json"))).toBe(true);
    expect(m.lifecycle.getError()?.direction).toBe("disable");
  });
});

describe("vault.json edited while locked", () => {
  it("prefs flipped to weaker ones are put back at unlock, and seal notes until then", async () => {
    await lockedInstall({ idleMinutes: 15 });
    editVaultJson((json) => ({ ...json, prefs: { ...(json.prefs as object), notesReadable: true, lockOnSleep: false, idleMinutes: 0 } }));
    const m = boot();
    expect(m.vault.getPrefs().notesReadable).toBe(true); // what the file says…
    expect(m.vault.sealsNotes()).toBe(true); // …isn't trusted before an unlock checks it

    await m.vault.unlockWithPassword(PASSWORD);
    expect(m.vault.getPrefs()).toMatchObject({ notesReadable: false, lockOnSleep: true, idleMinutes: 15 });
    expect(m.vault.getWarnings()).toEqual(["prefs"]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(vaultDir(), "vault.json"), "utf8"));
    expect(onDisk.prefs.notesReadable).toBe(false);
  });

  it("\"keep notes readable\" set by the user: notes written before the unlock checked it become plain again", async () => {
    await lockedInstall({ notesReadable: true });
    const m = boot();
    const locked = path.join(notesDir, "2026-09-26-080000.md");
    m.files.writeText(locked, "written while locked", { kind: "note", seal: m.vault.sealsNotes() });
    expect(fs.existsSync(`${locked}.wwenc`)).toBe(true);

    await m.vault.unlockWithPassword(PASSWORD);
    expect(fs.readFileSync(locked, "utf8")).toBe("written while locked");
    expect(fs.existsSync(`${locked}.wwenc`)).toBe(false);
    expect(m.vault.sealsNotes()).toBe(false);
    expect(m.vault.getWarnings()).toEqual([]);
  });

  it("a swapped sealing key is put back at unlock and reported", async () => {
    await lockedInstall();
    const attacker = crypto.randomBytes(32).toString("base64");
    editVaultJson((json) => ({ ...json, sealPublicKey: attacker }));
    const m = boot();
    expect(m.vault.sealPublicRaw().toString("base64")).toBe(attacker);

    await m.vault.unlockWithPassword(PASSWORD);
    expect(m.vault.getWarnings()).toEqual(["sealKey"]);
    expect(m.vault.sealPublicRaw().toString("base64")).not.toBe(attacker);
    expect(JSON.parse(fs.readFileSync(path.join(vaultDir(), "vault.json"), "utf8")).sealPublicKey).not.toBe(attacker);
  });

  it("a vault from before the prefs MAC gets one at its first unlock, without a warning", async () => {
    await lockedInstall();
    editVaultJson(({ prefsMac, ...json }) => {
      expect(prefsMac).toBeTruthy();
      return json;
    });
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);
    expect(m.vault.getWarnings()).toEqual([]);
    expect(typeof JSON.parse(fs.readFileSync(path.join(vaultDir(), "vault.json"), "utf8")).prefsMac).toBe("string");
  });
});

describe("plain copies of sealed stores", () => {
  it("are never read with encryption on (Memory swap rules planted as plain JSON)", async () => {
    await lockedInstall();
    const m = boot();
    await m.vault.unlockWithPassword(PASSWORD);
    fs.rmSync(`${vocab()}.wwenc`);
    fs.writeFileSync(vocab(), JSON.stringify([{ word: "planted", alternatives: ["send the report"] }]));

    expect(m.files.exists(vocab())).toBe(true); // stores see a file, so they don't start over empty
    expect(m.files.physicalPath(vocab())).toBeNull();
    expect(() => m.files.readJson(vocab(), [])).toThrow(m.vault.VaultLockedError);
    // Notes can be plain on purpose.
    const plainNote = path.join(notesDir, "2026-09-26-090000.md");
    fs.writeFileSync(plainNote, "plain note");
    expect(m.files.readText(plainNote)).toBe("plain note");
  });

  it("are read while a migration this vault signed is converting them", async () => {
    seedPlain();
    const m = boot({ withLifecycle: false });
    await turnOn(m); // journal written, nothing converted yet
    expect(m.files.readJson(vocab(), null)).toEqual([{ word: SECRET }]);
    m.journal.remove();
    expect(() => m.files.readJson(vocab(), null)).toThrow(m.vault.VaultLockedError);
  });
});
