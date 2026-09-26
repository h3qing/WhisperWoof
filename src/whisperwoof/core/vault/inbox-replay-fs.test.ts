/**
 * Replaying what was saved while locked, against a real SQLite database:
 * provisional transcription ids survive a crash between items, items wait
 * for a transcription that failed to import, and ops about a note that was
 * deleted since don't block the inbox forever.
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
    inbox: require("../../bridge/vault/vault-inbox.js"),
    handlersFor: require("../../bridge/vault/vault-inbox-handlers.js").createInboxHandlers,
  };
}

/** The parts of DatabaseManager / AudioStorage / app-init the handlers use, on a real db. */
function world(db: InstanceType<typeof Database>, opts: { audioFailsOnce?: boolean; transcriptionFails?: boolean } = {}) {
  let audioFailures = opts.audioFailsOnce ? 1 : 0;
  const audio = new Map<number, string>();
  const entries = new Map<string, { metadata?: { transcriptionId?: number } }>();
  const deps = {
    databaseManager: {
      db,
      saveTranscription: (text: string) => {
        if (opts.transcriptionFails) throw new Error("disk full");
        const r = db.prepare("INSERT INTO transcriptions (text) VALUES (?)").run(text);
        return { id: r.lastInsertRowid };
      },
      getTranscriptionById: (id: number) => db.prepare("SELECT * FROM transcriptions WHERE id = ?").get(id),
      updateTranscriptionAudio: () => {},
    },
    audioStorageManager: {
      saveAudio: (id: number, buf: Buffer) => {
        if (audioFailures > 0) {
          audioFailures -= 1;
          return { success: false };
        }
        audio.set(id, buf.toString());
        return { success: true };
      },
    },
    appInit: {
      saveWhisperWoofEntry: (e: { id: string; metadata?: { transcriptionId?: number } }) => {
        entries.set(e.id, e);
        return { id: e.id };
      },
    },
    projectNotes: {
      linkNoteToEntry: () => {
        throw new Error("Invalid note name");
      },
      setNoteProject: () => {},
      getDefaultProject: () => ({ id: "p1" }),
    },
    learnCorrections: () => {},
    broadcast: () => {},
  };
  return { deps, audio, entries };
}

async function lockedDictation(m: ReturnType<typeof boot>) {
  const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
  await m.vault.adoptNewVault(v, masterKey);
  const pid = m.inbox.provisionalTranscriptionId();
  m.inbox.record("transcription.save", { pid, text: "said while locked", rawText: null, options: null });
  m.inbox.record("transcription.audio", { pid, audio: Buffer.from("voice").toString("base64"), metadata: null });
  m.inbox.record("entry.save", { entry: { id: "e1", source: "voice", metadata: { transcriptionId: pid } } });
  return pid;
}

let db: InstanceType<typeof Database>;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-replay-"));
  db = new Database(":memory:");
  db.exec("CREATE TABLE transcriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, timestamp TEXT, created_at TEXT)");
});

afterEach(() => {
  db.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("sealed inbox replay", () => {
  it("links audio to the right transcription even across a restart between items", async () => {
    const m = boot();
    await lockedDictation(m);
    const first = world(db, { audioFailsOnce: true });
    const run1 = m.handlersFor(first.deps);
    const r1 = await m.inbox.replay(run1.handlers, { idMap: run1.loadIdMap() });
    expect(r1).toEqual({ applied: 2, failed: 1 });
    expect(first.entries.get("e1")?.metadata?.transcriptionId).toBe(1);

    // "Restart": a fresh id map, rebuilt from the database.
    const second = world(db);
    const run2 = m.handlersFor(second.deps);
    const r2 = await m.inbox.replay(run2.handlers, { idMap: run2.loadIdMap() });
    expect(r2).toEqual({ applied: 1, failed: 0 });
    expect(second.audio.get(1)).toBe("voice");
    expect(db.prepare("SELECT count(*) AS n FROM transcriptions").get().n).toBe(1);
  });

  it("keeps the audio and the entry waiting while their transcription can't import", async () => {
    const m = boot();
    await lockedDictation(m);
    const w = world(db, { transcriptionFails: true });
    const run = m.handlersFor(w.deps);
    const r = await m.inbox.replay(run.handlers, { idMap: run.loadIdMap() });
    expect(r).toEqual({ applied: 0, failed: 3 });
    expect(w.entries.size).toBe(0);
    expect(m.inbox.count()).toBe(3);
  });

  it("drops a link to a note that no longer exists instead of retrying forever", async () => {
    const m = boot();
    const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
    await m.vault.adoptNewVault(v, masterKey);
    m.inbox.record("note.linkEntry", { name: "gone.md", entryId: "e9" });
    const run = m.handlersFor(world(db).deps);
    expect(await m.inbox.replay(run.handlers, { idMap: run.loadIdMap() })).toEqual({ applied: 1, failed: 0 });
    expect(m.inbox.count()).toBe(0);
  });

  it("writes leftovers out as plain JSON when encryption is turned off", async () => {
    const m = boot();
    await lockedDictation(m);
    const out = path.join(userData, "unimported-while-locked");
    expect(m.inbox.exportRemaining(out)).toBe(3);
    expect(m.inbox.count()).toBe(0);
    const files = fs.readdirSync(out);
    expect(files).toHaveLength(3);
    expect(fs.readFileSync(path.join(out, files[0]), "utf8")).toContain("transcription.save");
  });
});
