/**
 * Words in clipboard images: the bf_image_text SQL and the Clipboard search
 * that uses it, on a real SQLite (Node's built-in node:sqlite; the app's
 * better-sqlite3 is built for Electron's ABI and can't load under vitest).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const imageDb = require("../../bridge/clipboard-image-text-db.js");

type Db = InstanceType<typeof DatabaseSync>;

function makeDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE bf_entries (
    id TEXT PRIMARY KEY, created_at TEXT, source TEXT, raw_text TEXT, polished TEXT,
    audio_path TEXT, metadata TEXT, favorite INTEGER NOT NULL DEFAULT 0
  )`);
  imageDb.createImageTextTable(db);
  imageDb.createImageTextTable(db); // idempotent, like every startup
  return db;
}

function add(db: Db, id: string, at: string, { source = "clipboard", raw = "", meta = {} as Record<string, unknown> } = {}) {
  db.prepare("INSERT INTO bf_entries (id, created_at, source, raw_text, polished, audio_path, metadata) VALUES (?, ?, ?, ?, NULL, ?, ?)").run(
    id,
    at,
    source,
    raw,
    `/images/${id}.png`,
    JSON.stringify(meta)
  );
}

const image = { type: "image", width: 10, height: 10 };

describe("bf_image_text", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
    add(db, "text", "2026-09-27T10:00:00Z", { raw: "hello" });
    add(db, "old", "2026-09-26T10:00:00Z", { raw: "[Image 10×10]", meta: image });
    add(db, "new", "2026-09-27T09:00:00Z", { raw: "[Image 10×10]", meta: image });
    add(db, "file", "2026-09-27T08:00:00Z", { raw: "[File] a.pdf", meta: { type: "file" } });
    add(db, "voice", "2026-09-27T08:00:00Z", { source: "voice", raw: "x", meta: image });
  });

  it("lists unread clipboard images newest first, and nothing else", () => {
    expect(imageDb.unreadImages(db, 10).map((r: { id: string }) => r.id)).toEqual(["new", "old"]);
    expect(imageDb.unreadImage(db, "old")?.audio_path).toBe("/images/old.png");
    expect(imageDb.unreadImage(db, "text")).toBeUndefined();
    expect(imageDb.unreadImage(db, "voice")).toBeUndefined();
  });

  it("records what was read and counts it", () => {
    expect(imageDb.recordImageText(db, "old", { text: "the bottleneck" })).toBe(true);
    expect(imageDb.unreadImages(db, 10).map((r: { id: string }) => r.id)).toEqual(["new"]);
    expect(imageDb.unreadImage(db, "old")).toBeUndefined();
    expect(imageDb.countImageText(db)).toEqual({ total: 2, read: 1, withText: 1 });
    expect(imageDb.recordImageText(db, "new", { failed: true })).toBe(true);
    expect(imageDb.countImageText(db)).toEqual({ total: 2, read: 2, withText: 1 });
    expect(imageDb.imageTextFor(db, "old")).toEqual({ status: "done", text: "the bottleneck" });
    expect(imageDb.imageTextFor(db, "new")).toEqual({ status: "failed", text: "" });
    expect(imageDb.imageTextFor(db, "text")).toEqual({ status: "unread", text: "" });
  });

  it("forgets an image's words when its entry is deleted, however it's deleted", () => {
    imageDb.recordImageText(db, "old", { text: "secret" });
    db.prepare("DELETE FROM bf_entries WHERE id = ?").run("old");
    expect(db.prepare("SELECT COUNT(*) AS n FROM bf_image_text").get().n).toBe(0);
    expect(imageDb.countImageText(db)).toEqual({ total: 1, read: 0, withText: 0 });
  });

  it("doesn't store words for an entry deleted while it was being read", () => {
    db.prepare("DELETE FROM bf_entries WHERE id = ?").run("new");
    expect(imageDb.recordImageText(db, "new", { text: "late" })).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bf_image_text").get().n).toBe(0);
  });

  it("hands out a page of texts and deletes them all when turned off", () => {
    imageDb.recordImageText(db, "old", { text: "a" });
    imageDb.recordImageText(db, "new", { text: "b" });
    expect([...imageDb.textsFor(db, ["old", "new", "text"]).entries()].sort()).toEqual([
      ["new", "b"],
      ["old", "a"],
    ]);
    expect(imageDb.textsFor(db, []).size).toBe(0);
    expect(imageDb.deleteAllImageText(db)).toBe(2);
    expect(imageDb.countImageText(db).read).toBe(0);
  });
});

describe("Clipboard search with words in images", () => {
  let db: Db;
  let store: Record<string, (...args: unknown[]) => any>;
  const writeText = vi.fn();
  const adopt = vi.fn();
  const status = { enabled: true, available: true, encrypted: false, state: "done", reason: null, total: 2, read: 2, withText: 1 };

  beforeEach(() => {
    writeText.mockReset();
    adopt.mockReset();
    db = makeDb();
    add(db, "note", "2026-09-27T10:00:00Z", { raw: "the bottleneck in plain text" });
    add(db, "shot", "2026-09-27T09:00:00Z", { raw: "[Image 10×10]", meta: image });
    add(db, "photo", "2026-09-27T08:00:00Z", { raw: "[Image 10×10] bottleneck.png", meta: { ...image, fileName: "bottleneck.png" } });
    add(db, "blank", "2026-09-27T07:00:00Z", { raw: "[Image 10×10]", meta: image });
    imageDb.recordImageText(db, "shot", { text: "我让他独立的验证\n看看到底哪个是bottleneck 然后" });
    imageDb.recordImageText(db, "blank", { text: "" });

    const inject = (request: string, exports: unknown) => {
      const resolved = require.resolve(request);
      require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
    };
    inject("electron", {
      app: { getPath: () => "/tmp" },
      clipboard: { writeText },
      nativeImage: {},
      BrowserWindow: { getAllWindows: () => [] },
      shell: {},
    });
    inject("../../../helpers/debugLogger.js", { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() });
    inject("../../bridge/app-init.js", { getWhisperWoofDb: () => db, adoptCurrentClipboard: adopt });
    inject("../../bridge/markdown-route.js", { readSettings: () => ({}), updateSettings: vi.fn() });
    inject("../../bridge/clipboard-image-text.js", {
      getStatus: () => status,
      setEnabled: vi.fn(() => ({ imageText: { ...status, enabled: false }, deleted: 1 })),
    });
    delete require.cache[require.resolve("../../bridge/clipboard-store.js")];
    store = require("../../bridge/clipboard-store.js");
  });

  it("finds a screenshot by the words in it, with the words around the match", () => {
    const items = store.listClipboard({ kind: "image", query: "Bottleneck" });
    expect(items.map((i: { id: string }) => i.id)).toEqual(["shot", "photo"]);
    expect(items[0].textMatch).toEqual({ before: "我让他独立的验证 看看到底哪个是", match: "bottleneck", after: " 然后" });
    // Found by its file name, not its words: no snippet.
    expect(items[1].textMatch).toBeUndefined();
  });

  it("finds Chinese words", () => {
    expect(store.listClipboard({ kind: "image", query: "哪个是" }).map((i: { id: string }) => i.id)).toEqual(["shot"]);
  });

  it("treats % and _ in a search as themselves", () => {
    expect(store.listClipboard({ kind: "image", query: "%" })).toEqual([]);
    expect(store.listClipboard({ kind: "image", query: "_" })).toEqual([]);
  });

  it("leaves the text column's search alone", () => {
    expect(store.listClipboard({ kind: "text", query: "bottleneck" }).map((i: { id: string }) => i.id)).toEqual(["note"]);
    expect(store.listClipboard({ kind: "image" }).every((i: { textMatch?: unknown }) => !i.textMatch)).toBe(true);
  });

  it("shows and copies one image's words, without adding them to history", () => {
    expect(store.imageText("shot")).toMatchObject({ status: "done" });
    expect(store.imageText("note")).toEqual({ success: false, error: "Not an image" });
    expect(store.imageText("nope")).toEqual({ success: false, error: "Not a clipboard item" });
    expect(store.copyImageText("shot")).toEqual({ success: true });
    expect(writeText).toHaveBeenCalledWith("我让他独立的验证\n看看到底哪个是bottleneck 然后");
    expect(adopt).toHaveBeenCalled();
    expect(store.copyImageText("blank")).toEqual({ success: false, error: "No words found in this image" });
    expect(store.copyImageText("photo")).toEqual({ success: false, error: "No words found in this image" });
  });

  it("reports reading progress in the summary and passes the switch to the reader", () => {
    expect(store.summary().imageText).toEqual(status);
    expect(store.setImageText({ enabled: false })).toMatchObject({ deleted: 1 });
  });
});
