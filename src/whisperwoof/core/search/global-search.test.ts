/**
 * ⌘K search everything (bridge/global-search.js) on a real SQLite
 * (node:sqlite; the app's better-sqlite3 is built for Electron's ABI): the
 * history, clipboard text, images by their words, and kept files.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const imageDb = require("../../bridge/clipboard-image-text-db.js");

type Db = InstanceType<typeof DatabaseSync>;

let db: Db;
let imageTextStatus = { enabled: true, available: true };
let search: {
  searchEverything: (q: string) => any;
  searchEntries: (db: Db | null, q: string, o?: { limit?: number; sources?: string[] | null }) => any[];
  LIMITS: Record<string, number>;
};

let n = 0;
function add(source: string, text: string, { meta = {} as Record<string, unknown>, polished = null as string | null, at = "" } = {}) {
  n += 1;
  const id = `${source}-${n}`;
  db.prepare(
    "INSERT INTO bf_entries (id, created_at, source, raw_text, polished, audio_path, metadata) VALUES (?, ?, ?, ?, ?, NULL, ?)"
  ).run(id, at || new Date(Date.UTC(2026, 8, 27, 0, n)).toISOString(), source, text, polished, JSON.stringify(meta));
  return id;
}

function mapEntryRow(row: Record<string, unknown>) {
  return { id: row.id, createdAt: row.created_at, source: row.source, rawText: row.raw_text, polished: row.polished, metadata: row.metadata };
}

beforeEach(() => {
  n = 0;
  imageTextStatus = { enabled: true, available: true };
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE bf_entries (
    id TEXT PRIMARY KEY, created_at TEXT, source TEXT, raw_text TEXT, polished TEXT,
    audio_path TEXT, metadata TEXT, favorite INTEGER NOT NULL DEFAULT 0
  )`);
  imageDb.createImageTextTable(db);

  const inject = (request: string, exports: unknown) => {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
  };
  inject("electron", {
    app: { getPath: () => "/tmp" },
    clipboard: { writeText: vi.fn() },
    nativeImage: {},
    BrowserWindow: { getAllWindows: () => [] },
    shell: {},
  });
  inject("../../../helpers/debugLogger.js", { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() });
  inject("../../bridge/app-init.js", { getWhisperWoofDb: () => db, mapEntryRow, adoptCurrentClipboard: vi.fn() });
  inject("../../bridge/markdown-route.js", { readSettings: () => ({}), updateSettings: vi.fn() });
  inject("../../bridge/clipboard-image-text.js", { getStatus: () => ({ ...imageTextStatus, state: "done" }) });
  for (const mod of ["../../bridge/clipboard-store.js", "../../bridge/global-search.js"]) delete require.cache[require.resolve(mod)];
  search = require("../../bridge/global-search.js");
});

describe("search everything", () => {
  it("finds part of a Chinese sentence in the history (FTS5 couldn't)", () => {
    add("voice", "我让他独立的再把每一个环节独立的验证 看看到底哪个是bottleneck");
    add("voice", "Nothing about it");
    const r = search.searchEverything("哪个是");
    expect(r.history.items).toHaveLength(1);
    expect(r.history.items[0]).toMatchObject({ source: "voice", snippet: { match: "哪个是" } });
    expect(r.history.items[0].entry).toMatchObject({ source: "voice" });
  });

  it("shows the polished text, and finds words only in the raw transcript too", () => {
    add("voice", "um so the bottle neck is the database", { polished: "The bottleneck is the database." });
    add("meeting", "we talked about the bottleneck", {});
    const r = search.searchEverything("bottle neck");
    expect(r.history.items).toHaveLength(1);
    expect(r.history.items[0].text).toBe("The bottleneck is the database.");
    expect(r.history.items[0].snippet).toMatchObject({ match: "bottle neck" });
    expect(search.searchEverything("bottleneck").history.items.map((h: { source: string }) => h.source)).toEqual(["meeting", "voice"]);
  });

  it("keeps clipboard entries out of History and lists them in their own groups", () => {
    add("voice", "the bottleneck, dictated");
    add("clipboard", "the bottleneck, copied");
    const shot = add("clipboard", "[Image 10×10]", { meta: { type: "image" } });
    add("clipboard", "[File] bottleneck-report.pdf", { meta: { type: "file", fileName: "bottleneck-report.pdf" } });
    add("clipboard", "[Image 10×10]", { meta: { type: "image" } });
    imageDb.recordImageText(db, shot, { text: "p95: the real bottleneck was the DB" });

    const r = search.searchEverything("bottleneck");
    expect(r.history.items.map((h: { text: string }) => h.text)).toEqual(["the bottleneck, dictated"]);
    expect(r.clipboard.items.map((c: { text: string }) => c.text)).toEqual(["the bottleneck, copied"]);
    expect(r.clipboard.items[0].snippet).toMatchObject({ match: "bottleneck" });
    expect(r.images.items.map((i: { id: string }) => i.id)).toEqual([shot]);
    expect(r.images.items[0].textMatch).toMatchObject({ match: "bottleneck" });
    expect(r.files.items.map((f: { fileName: string }) => f.fileName)).toEqual(["bottleneck-report.pdf"]);
    expect(r.imageText).toEqual({ enabled: true, available: true });
  });

  it("ranks every kind in one pass the same way as a query per kind (pinned first, then newest)", () => {
    const old = add("clipboard", "xy marks the spot");
    add("clipboard", "xy again");
    const newest = add("clipboard", "and xy once more");
    const shot = add("clipboard", "[Image 10×10]", { meta: { type: "image" } });
    const file = add("clipboard", "[File] xy.pdf", { meta: { type: "file", fileName: "xy.pdf" } });
    imageDb.recordImageText(db, shot, { text: "xy in a screenshot" });
    db.prepare("UPDATE bf_entries SET favorite = 1 WHERE id = ?").run(old);
    const store = require("../../bridge/clipboard-store.js");
    const limits = { text: 2, image: 2, file: 2 };
    const ids = (found: Record<string, Array<{ id: string }>>) =>
      Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.map((i) => i.id)]));
    // "xy" takes the one-pass path, "x" (one character) the per-kind one; both find the same.
    const onePass = store.searchClipboard("xy", limits);
    const perKind = store.searchClipboard("x", limits);
    expect(ids(onePass)).toEqual({ text: [old, newest], image: [shot], file: [file] });
    expect(ids(perKind)).toEqual(ids(onePass));
    expect(onePass.image[0].textMatch).toMatchObject({ match: "xy" });
    expect(onePass.text[0]).toMatchObject({ kind: "text", pinned: true, text: "xy marks the spot" });
  });

  it("says when a group has more than it shows", () => {
    for (let i = 0; i < search.LIMITS.history + 2; i++) add("voice", `note ${i} about latency`);
    for (let i = 0; i < search.LIMITS.clipboard; i++) add("clipboard", `latency ${i}`);
    const r = search.searchEverything("latency");
    expect(r.history.items).toHaveLength(search.LIMITS.history);
    expect(r.history.more).toBe(true);
    expect(r.clipboard.items).toHaveLength(search.LIMITS.clipboard);
    expect(r.clipboard.more).toBe(false);
    // Newest first.
    expect(r.history.items[0].text).toBe(`note ${search.LIMITS.history + 1} about latency`);
  });

  it("treats % and _ as themselves, and an empty box as nothing", () => {
    add("voice", "100% sure");
    add("voice", "no percent here");
    expect(search.searchEverything("%").history.items.map((h: { text: string }) => h.text)).toEqual(["100% sure"]);
    expect(search.searchEverything("_").history.items).toEqual([]);
    const empty = search.searchEverything("   ");
    expect(empty).toMatchObject({ query: "", history: { items: [], more: false }, clipboard: { items: [] } });
    expect(empty.imageText).toEqual({ enabled: true, available: true });
  });

  it("returns nothing while locked (no database)", () => {
    add("voice", "hello");
    const open = db;
    db = null as unknown as Db;
    expect(search.searchEverything("hello").history.items).toEqual([]);
    db = open;
  });
});

describe("searchEntries (History's own search)", () => {
  it("searches every source when none is named, newest first, up to the limit", () => {
    add("voice", "alpha one");
    add("clipboard", "alpha two");
    add("import", "alpha three");
    expect(search.searchEntries(db, "alpha", {}).map((r: { raw_text: string }) => r.raw_text)).toEqual(["alpha three", "alpha two", "alpha one"]);
    expect(search.searchEntries(db, "alpha", { limit: 1 })).toHaveLength(1);
    expect(search.searchEntries(db, "alpha", { sources: ["voice"] })).toHaveLength(1);
    expect(search.searchEntries(db, "\"quoted -dash", {})).toEqual([]);
    expect(search.searchEntries(null, "alpha")).toEqual([]);
  });
});
