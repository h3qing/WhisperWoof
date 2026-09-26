import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const inbox = require("../../bridge/vault/inbox-pure.js");

const at = (iso: string) => new Date(iso);

describe("makeItem / parseItem", () => {
  it("round-trips a known op through JSON", () => {
    const item = inbox.makeItem("entry.save", { entry: { id: "e1" } }, { seq: 3, now: at("2026-09-25T10:00:00Z") });
    expect(inbox.parseItem(JSON.parse(JSON.stringify(item)))).toEqual(item);
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses unknown ops and malformed items", () => {
    expect(() => inbox.makeItem("shell.exec", {}, { seq: 1 })).toThrow();
    const ok = inbox.makeItem("entry.save", {}, { seq: 1 });
    expect(() => inbox.parseItem({ ...ok, op: "shell.exec" })).toThrow();
    expect(() => inbox.parseItem({ ...ok, v: 9 })).toThrow();
    expect(() => inbox.parseItem({ ...ok, seq: "1" })).toThrow();
    expect(() => inbox.parseItem({ ...ok, data: null })).toThrow();
  });
});

describe("ordering", () => {
  it("file names sort in the order the items were made", () => {
    const a = inbox.makeItem("entry.save", {}, { seq: 9, now: at("2026-09-25T10:00:00Z") });
    const b = inbox.makeItem("entry.save", {}, { seq: 10, now: at("2026-09-25T10:00:00Z") });
    const c = inbox.makeItem("entry.save", {}, { seq: 1, now: at("2026-09-25T10:00:01Z") });
    const names = [c, b, a].map(inbox.itemFileName).sort();
    expect(names).toEqual([a, b, c].map(inbox.itemFileName));
    expect(inbox.sortItems([c, b, a]).map((i: { id: string }) => i.id)).toEqual([a.id, b.id, c.id]);
  });

  it("recognizes its own file names only", () => {
    const a = inbox.makeItem("entry.save", {}, { seq: 1 });
    expect(inbox.isItemFileName(inbox.itemFileName(a))).toBe(true);
    expect(inbox.isItemFileName("../x.wwenc")).toBe(false);
    expect(inbox.isItemFileName("notes.md")).toBe(false);
  });
});

describe("provisional transcription ids", () => {
  it("are negative safe integers, unique per sequence number", () => {
    const now = at("2026-09-25T10:00:00Z");
    const a = inbox.provisionalId(1, now);
    const b = inbox.provisionalId(2, now);
    expect(Number.isSafeInteger(a) && a < 0).toBe(true);
    expect(a).not.toBe(b);
    expect(inbox.isProvisionalId(a)).toBe(true);
    expect(inbox.isProvisionalId(42)).toBe(false);
  });

  it("remapEntry swaps a provisional transcriptionId for the real one, without mutating", () => {
    const pid = inbox.provisionalId(1, at("2026-09-25T10:00:00Z"));
    const entry = { id: "e1", metadata: { transcriptionId: pid, stt: { model: "x" } } };
    const out = inbox.remapEntry(entry, new Map([[pid, 77]]));
    expect(out.metadata).toEqual({ transcriptionId: 77, stt: { model: "x" } });
    expect(entry.metadata.transcriptionId).toBe(pid);
  });

  it("drops a provisional id that never got a real row", () => {
    const pid = inbox.provisionalId(1, at("2026-09-25T10:00:00Z"));
    const out = inbox.remapEntry({ id: "e1", metadata: { transcriptionId: pid } }, new Map());
    expect(out.metadata).toEqual({});
  });

  it("leaves real ids and entries without metadata alone", () => {
    expect(inbox.remapEntry({ id: "e1", metadata: { transcriptionId: 5 } }, new Map()).metadata).toEqual({ transcriptionId: 5 });
    expect(inbox.remapEntry({ id: "e1" }, new Map())).toEqual({ id: "e1" });
  });
});
