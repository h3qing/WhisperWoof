/**
 * Storage cleanup with encryption on: the database keeps logical paths
 * ("<uuid>.png") while the bytes live in "<uuid>.png.wwenc". Orphan cleanup
 * must not mistake every sealed image for an orphan, and deleting an entry
 * must remove its sealed file.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
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
    if (key.includes(`${path.sep}bridge${path.sep}vault${path.sep}`) || key.endsWith("debugLogger.js") || key.endsWith("storage-manager.js")) {
      delete require.cache[key];
    }
  }
  return {
    vault: require("../../bridge/vault/vault-service.js"),
    keys: require("../../bridge/vault/vault-keys-pure.js"),
    files: require("../../bridge/vault/vault-files.js"),
    storage: require("../../bridge/storage-manager.js"),
  };
}

/** Just enough of better-sqlite3 for storage-manager's two queries. */
function fakeDb(rows: { id: string; audio_path: string | null; metadata: string }[]) {
  const live = [...rows];
  return {
    live,
    prepare: (sql: string) => ({
      all: () => live.filter((r) => r.audio_path !== null),
      get: (id: string) => live.find((r) => r.id === id),
      run: (id: string) => {
        if (sql.startsWith("DELETE")) live.splice(live.findIndex((r) => r.id === id), 1);
      },
    }),
  };
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-storage-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("storage cleanup with sealed images", () => {
  async function setup() {
    const m = boot();
    const { vault: v, masterKey } = m.keys.createVault({ entropy: crypto.randomBytes(16), password: "a good password", kdf: FAST });
    await m.vault.adoptNewVault(v, masterKey);
    const dir = path.join(userData, "whisperwoof-images");
    const kept = path.join(dir, "kept.png");
    const orphan = path.join(dir, "orphan.png");
    m.files.writeFile(kept, Buffer.from("kept image"), { kind: "image" });
    m.files.writeFile(path.join(dir, "kept_thumb.png"), Buffer.from("thumb"), { kind: "image" });
    m.files.writeFile(orphan, Buffer.from("orphan image"), { kind: "image" });
    const db = fakeDb([{ id: "e1", audio_path: kept, metadata: JSON.stringify({ thumbPath: path.join(dir, "kept_thumb.png") }) }]);
    m.storage.setDatabase(db);
    return { m, dir, kept, orphan, db };
  }

  it("orphan cleanup keeps referenced sealed images and removes unreferenced ones", async () => {
    const { m, dir, kept, orphan } = await setup();
    const result = m.storage.cleanupOrphanedFiles();
    expect(result.removed).toBe(1);
    expect(m.files.exists(kept)).toBe(true);
    expect(m.files.exists(path.join(dir, "kept_thumb.png"))).toBe(true);
    expect(m.files.exists(orphan)).toBe(false);
  });

  it("deleting an entry removes its sealed image and thumbnail", async () => {
    const { m, dir, kept } = await setup();
    const result = m.storage.deleteEntriesWithCleanup(["e1"]);
    expect(result.filesRemoved).toBe(2);
    expect(m.files.exists(kept)).toBe(false);
    expect(m.files.exists(path.join(dir, "kept_thumb.png"))).toBe(false);
  });
});
