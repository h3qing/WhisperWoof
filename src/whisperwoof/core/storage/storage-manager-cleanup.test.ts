/**
 * Storage Manager deletes against a real temp userData folder and an
 * in-memory stand-in for bf_entries (better-sqlite3 is built for Electron's
 * ABI, so it can't load under vitest). Deleting an entry removes the app's
 * own copies (clipboard images) and never the user's original files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let userData = "";
let userFiles = "";

type Row = { id: string; source: string; audio_path: string | null; metadata: string };

function fakeDb(rows: Row[]) {
  const entries = new Map(rows.map((r) => [r.id, r]));
  const prepare = (sql: string) => ({
    get: (id: string) => entries.get(id),
    all: (source: string) => [...entries.values()].filter((r) => r.source === source),
    run: (id: string) => {
      if (sql.startsWith("DELETE")) entries.delete(id);
    },
  });
  return { entries, db: { prepare } };
}

function load() {
  const inject = (request: string, exports: unknown) => {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
  };
  inject("electron", { app: { getPath: () => userData, isReady: () => false } });
  inject("../../../helpers/debugLogger.js", { log: vi.fn(), debug: vi.fn(), warn: vi.fn() });
  delete require.cache[require.resolve("../../bridge/storage-manager.js")];
  return require("../../bridge/storage-manager.js");
}

function write(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  return file;
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ww-storage-"));
  userData = path.join(base, "userData");
  userFiles = path.join(base, "Music");
  fs.mkdirSync(userData);
});

afterEach(() => {
  fs.rmSync(path.dirname(userData), { recursive: true, force: true });
});

describe("deleteEntriesWithCleanup", () => {
  it("keeps the user's original file when an imported entry is deleted", () => {
    const original = write(path.join(userFiles, "interview.m4a"));
    const { entries, db } = fakeDb([{ id: "imp", source: "import", audio_path: original, metadata: "{}" }]);
    const sm = load();
    sm.setDatabase(db);

    const result = sm.deleteEntriesWithCleanup(["imp"]);

    expect(fs.existsSync(original)).toBe(true);
    expect(entries.has("imp")).toBe(false);
    expect(result).toEqual({ deleted: 1, filesRemoved: 0 });
  });

  it("removes a clipboard image and its thumbnail from the app folder", () => {
    const img = write(path.join(userData, "whisperwoof-images", "i.png"));
    const thumb = write(path.join(userData, "whisperwoof-images", "i_thumb.png"));
    const { db } = fakeDb([
      { id: "img", source: "clipboard", audio_path: img, metadata: JSON.stringify({ type: "image", thumbPath: thumb }) },
    ]);
    const sm = load();
    sm.setDatabase(db);

    expect(sm.deleteEntriesWithCleanup(["img"])).toEqual({ deleted: 1, filesRemoved: 2 });
    expect(fs.existsSync(img)).toBe(false);
    expect(fs.existsSync(thumb)).toBe(false);
  });

  it("never unlinks paths outside the app folders, even via `..` or a symlink", () => {
    const secret = write(path.join(userFiles, "secret.txt"));
    const traversal = path.join(userData, "whisperwoof-images", "..", "..", "Music", "secret.txt");
    const link = path.join(userData, "whisperwoof-images", "link.png");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(secret, link);
    const { db } = fakeDb([
      { id: "a", source: "voice", audio_path: traversal, metadata: "{}" },
      { id: "b", source: "voice", audio_path: link, metadata: JSON.stringify({ thumbPath: secret }) },
    ]);
    const sm = load();
    sm.setDatabase(db);

    expect(sm.deleteEntriesWithCleanup(["a", "b"])).toEqual({ deleted: 2, filesRemoved: 0 });
    expect(fs.existsSync(secret)).toBe(true);
  });
});

describe("deleteEntriesBySource", () => {
  it("clears every import without touching the original files", () => {
    const one = write(path.join(userFiles, "one.mp3"));
    const two = write(path.join(userFiles, "two.wav"));
    const { entries, db } = fakeDb([
      { id: "1", source: "import", audio_path: one, metadata: "{}" },
      { id: "2", source: "import", audio_path: two, metadata: "{}" },
    ]);
    const sm = load();
    sm.setDatabase(db);

    expect(sm.deleteEntriesBySource("import")).toEqual({ deleted: 2, filesRemoved: 0 });
    expect(entries.size).toBe(0);
    expect(fs.existsSync(one) && fs.existsSync(two)).toBe(true);
  });
});
