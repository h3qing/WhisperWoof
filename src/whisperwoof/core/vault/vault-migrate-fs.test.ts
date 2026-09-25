/**
 * Turning encryption on and off against a real temp userData: a real
 * SQLCipher database (better-sqlite3-multiple-ciphers' prebuilt loads under
 * Node), real files, and simulated crashes at every step.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const SECRET = "zebra-quartz-secret";
const FAST = { N: 1024, r: 8, p: 1 };

let userData = "";
let notesDir = "";

function freshModules() {
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
    migrate: require("../../bridge/vault/vault-migrate.js"),
    files: require("../../bridge/vault/vault-files.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    db: require("../../bridge/vault/vault-db.js"),
  };
}

function seedPlainData() {
  const dbFile = path.join(userData, "transcriptions.db");
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE transcriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT);
    CREATE TABLE bf_entries (id TEXT PRIMARY KEY, raw_text TEXT, polished TEXT);
    CREATE VIRTUAL TABLE bf_entries_fts USING fts5(raw_text, polished, content=bf_entries, content_rowid=rowid);
    CREATE TRIGGER bf_ai AFTER INSERT ON bf_entries BEGIN
      INSERT INTO bf_entries_fts(rowid, raw_text, polished) VALUES (new.rowid, new.raw_text, new.polished);
    END;`);
  for (let i = 0; i < 50; i++) {
    db.prepare("INSERT INTO transcriptions (text) VALUES (?)").run(`dictation ${i} ${SECRET}`);
    db.prepare("INSERT INTO bf_entries VALUES (?, ?, ?)").run(`e${i}`, `raw ${i} ${SECRET}`, null);
  }
  db.close(); // leaves a -wal? No: the last close checkpoints. Write one more via a live WAL below.
  const live = new Database(dbFile);
  live.prepare("INSERT INTO bf_entries VALUES (?, ?, ?)").run("wal-only", `in the wal ${SECRET}`, null);
  // keep `live` open until the test closes it, like a crashed app would
  fs.mkdirSync(path.join(userData, "audio"));
  fs.writeFileSync(path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm"), Buffer.from(`voice ${SECRET}`));
  fs.mkdirSync(path.join(userData, "whisperwoof-images"));
  fs.writeFileSync(path.join(userData, "whisperwoof-images", "a.png"), crypto.randomBytes(200000));
  fs.writeFileSync(path.join(userData, "whisperwoof-vocabulary.json"), JSON.stringify([{ word: SECRET }]));
  fs.writeFileSync(path.join(userData, "whisperwoof-settings.json"), JSON.stringify({ notesDirectory: notesDir }));
  fs.writeFileSync(path.join(notesDir, "2026-09-25-101500.md"), `---\ntitle: "x"\n---\nnote ${SECRET}\n`);
  fs.writeFileSync(path.join(notesDir, "readme.txt"), "not a note");
  fs.mkdirSync(path.join(userData, "logs"));
  fs.writeFileSync(path.join(userData, "logs", "debug-1.log"), `transcript ${SECRET}`);
  return { dbFile, live };
}

/** Every file under a folder whose bytes contain the secret. */
function leaks(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...leaks(p));
    else if (fs.readFileSync(p).includes(SECRET)) out.push(p);
  }
  return out;
}

async function turnOn(m: ReturnType<typeof freshModules>, opts: { sealNotes?: boolean } = {}) {
  const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
  await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: opts.sealNotes ?? true });
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-vault-ud-"));
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-vault-notes-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("turning encryption on", () => {
  it("leaves no plaintext behind and keeps every row, FTS included", async () => {
    const m = freshModules();
    const { dbFile, live } = seedPlainData();
    live.close();
    await turnOn(m);

    expect(leaks(userData)).toEqual([]);
    expect(leaks(notesDir)).toEqual([]);
    expect(fs.existsSync(path.join(notesDir, "2026-09-25-101500.md.wwenc"))).toBe(true);
    expect(fs.readFileSync(path.join(notesDir, "readme.txt"), "utf8")).toBe("not a note");
    expect(fs.existsSync(path.join(userData, "vault", "migration.json"))).toBe(false);

    const db = m.db.openDatabase(Database, dbFile);
    expect(db.prepare("SELECT count(*) AS n FROM bf_entries").get().n).toBe(51);
    expect(db.prepare("SELECT count(*) AS n FROM bf_entries_fts WHERE bf_entries_fts MATCH ?").get("wal").n).toBe(1);
    db.close();
    expect(() => new Database(dbFile).prepare("SELECT 1 FROM bf_entries").get()).toThrow(/not a database/);

    expect(m.files.readJson(path.join(userData, "whisperwoof-vocabulary.json"), null)).toEqual([{ word: SECRET }]);
    expect(m.files.readText(path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm"))).toBe(`voice ${SECRET}`);
  });

  it("picks up rows that only exist in the WAL of a crashed app, and leaves no plaintext WAL", async () => {
    const m = freshModules();
    const { dbFile, live } = seedPlainData();
    // Snapshot the files while the connection is still open (= what a crash leaves on disk).
    const snap = ["", "-wal", "-shm"].filter((s) => fs.existsSync(dbFile + s));
    expect(snap).toContain("-wal");
    const copies = snap.map((s) => [s, fs.readFileSync(dbFile + s)] as const);
    live.close();
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(dbFile + s, { force: true });
    for (const [s, bytes] of copies) fs.writeFileSync(dbFile + s, bytes);
    expect(fs.readFileSync(dbFile + "-wal").includes(SECRET)).toBe(true);

    await turnOn(m);
    expect(leaks(userData)).toEqual([]);
    const db = m.db.openDatabase(Database, dbFile);
    expect(db.prepare("SELECT raw_text FROM bf_entries WHERE id = 'wal-only'").get()?.raw_text).toBe(`in the wal ${SECRET}`);
    db.close();
  });

  it("keeps notes readable when asked to", async () => {
    const m = freshModules();
    seedPlainData().live.close();
    await turnOn(m, { sealNotes: false });
    expect(fs.existsSync(path.join(notesDir, "2026-09-25-101500.md"))).toBe(true);
    expect(leaks(userData)).toEqual([]);
  });

  it("can't read sealed files once locked, but can still write them", async () => {
    const m = freshModules();
    seedPlainData().live.close();
    await turnOn(m);
    await m.vault.lock();
    const vocab = path.join(userData, "whisperwoof-vocabulary.json");
    expect(() => m.files.readJson(vocab, null)).toThrow(m.vault.VaultLockedError);
    m.files.writeJson(path.join(userData, "whisperwoof-templates.json"), [{ name: "t" }]);
    expect(fs.existsSync(path.join(userData, "whisperwoof-templates.json.wwenc"))).toBe(true);
    await m.vault.unlockWithPassword("a good password");
    expect(m.files.readJson(path.join(userData, "whisperwoof-templates.json"), null)).toEqual([{ name: "t" }]);
  });
});

describe("interrupted migration resumes", () => {
  async function prepared() {
    const m = freshModules();
    const { dbFile, live } = seedPlainData();
    live.close();
    const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
    await m.vault.adoptNewVault(v, masterKey);
    return { m, dbFile };
  }

  it("after a crash between the two database renames", async () => {
    const { m, dbFile } = await prepared();
    // Do the conversion, then undo the second rename to mimic the crash point.
    m.migrate.migrateDatabase(Database, dbFile, "enable", m.vault.requireKeys().dbKeyHex);
    fs.renameSync(dbFile, dbFile + ".vault-work");
    fs.copyFileSync(dbFile + ".vault-work", dbFile + ".vault-old"); // stand-in for the plain original
    await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: true });
    expect(leaks(userData)).toEqual([]);
    const db = m.db.openDatabase(Database, dbFile);
    expect(db.prepare("SELECT count(*) AS n FROM bf_entries").get().n).toBe(51);
    db.close();
  });

  it("after a half-written copy of the database", async () => {
    const { m, dbFile } = await prepared();
    fs.writeFileSync(dbFile + ".vault-work", "garbage from a crash");
    await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: true });
    expect(fs.existsSync(dbFile + ".vault-work")).toBe(false);
    expect(leaks(userData)).toEqual([]);
  });

  it("after a crash between sealing a file and deleting the original, and with temp files lying around", async () => {
    const { m } = await prepared();
    const audio = path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm");
    const ww = require("../../bridge/vault/wwenc-pure.js");
    fs.writeFileSync(audio + ".wwenc", ww.encrypt(fs.readFileSync(audio), m.vault.sealPublicRaw(), { kind: "audio" }));
    fs.writeFileSync(audio + ".wwenc.tmp-0badc0de", "partial");
    fs.writeFileSync(path.join(userData, "vault", "migration.json"), JSON.stringify({ v: 1, direction: "enable", startedAt: new Date().toISOString(), phase: "files" }));
    // the database phase is "done" in the journal but still plain on disk; the files phase must not care
    await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: true });
    expect(fs.existsSync(audio)).toBe(false);
    expect(fs.existsSync(audio + ".wwenc.tmp-0badc0de")).toBe(false);
    expect(m.files.readText(audio)).toBe(`voice ${SECRET}`);
  });

  it("re-seals a sealed copy that doesn't match its original instead of deleting the original", async () => {
    const { m } = await prepared();
    const audio = path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm");
    const ww = require("../../bridge/vault/wwenc-pure.js");
    fs.writeFileSync(audio + ".wwenc", ww.encrypt(Buffer.from("something else"), m.vault.sealPublicRaw(), { kind: "audio" }));
    await m.migrate.run("enable", { Database, userData, notesDir, sealNotes: true });
    expect(m.files.readText(audio)).toBe(`voice ${SECRET}`);
  });
});

describe("turning encryption off", () => {
  it("restores every plain file and the plain database", async () => {
    const m = freshModules();
    const { dbFile, live } = seedPlainData();
    live.close();
    await turnOn(m);
    await m.migrate.run("disable", { Database, userData, notesDir, sealNotes: true });
    await m.vault.forgetVault();

    const db = new Database(dbFile);
    expect(db.prepare("SELECT count(*) AS n FROM bf_entries").get().n).toBe(51);
    db.close();
    expect(fs.readFileSync(path.join(notesDir, "2026-09-25-101500.md"), "utf8")).toContain(SECRET);
    expect(fs.readFileSync(path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm"), "utf8")).toBe(`voice ${SECRET}`);
    const sealedLeft = (dir: string) => fs.readdirSync(dir).filter((n) => n.endsWith(".wwenc"));
    expect(sealedLeft(notesDir)).toEqual([]);
    expect(sealedLeft(path.join(userData, "audio"))).toEqual([]);
    expect(fs.existsSync(path.join(userData, "vault", "vault.json"))).toBe(false);
  });

  it("stops (and deletes nothing) when a sealed file was tampered with", async () => {
    const m = freshModules();
    seedPlainData().live.close();
    await turnOn(m);
    const sealed = path.join(userData, "audio", "OpenWhispr-2026-09-25-1.webm.wwenc");
    const bytes = fs.readFileSync(sealed);
    bytes[bytes.length - 3] ^= 1;
    fs.writeFileSync(sealed, bytes);
    await expect(m.migrate.run("disable", { Database, userData, notesDir, sealNotes: true })).rejects.toThrow();
    expect(fs.existsSync(sealed)).toBe(true);
  });
});
