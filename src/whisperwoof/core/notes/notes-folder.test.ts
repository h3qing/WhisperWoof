/**
 * The Notes view shows the .md files Fn+N writes into the notes folder. The
 * files stay the source of truth (Obsidian / iCloud keep working), so these are
 * the rules for reading, editing and naming them. Imports the real bridge
 * module the IPC handlers use.
 */
import { describe, it, expect } from "vitest";
import * as notes from "../../bridge/notes-folder-pure.js";

const fnNote = [
  "---",
  'title: "Call the landlord about the heater"',
  "date: 2026-09-23T14:05:09.000Z",
  "source: voice",
  "app: WhisperWoof",
  "---",
  "Call the landlord about the heater. It's been broken since Monday.",
  "",
].join("\n");

describe("isSafeNoteName", () => {
  it("accepts a plain .md file name", () => {
    expect(notes.isSafeNoteName("2026-09-23-220509.md")).toBe(true);
    expect(notes.isSafeNoteName("Groceries list.md")).toBe(true);
  });

  it("rejects anything that could leave the notes folder or isn't a note", () => {
    for (const bad of ["../secrets.md", "sub/dir.md", "a\\b.md", ".hidden.md", "note.txt", "", "..", "x.md/"]) {
      expect(notes.isSafeNoteName(bad)).toBe(false);
    }
    expect(notes.isSafeNoteName(undefined)).toBe(false);
  });
});

describe("parseNote", () => {
  it("takes the title from Fn+N frontmatter and the body after it", () => {
    const parsed = notes.parseNote(fnNote);
    expect(parsed.title).toBe("Call the landlord about the heater");
    expect(parsed.body).toBe("Call the landlord about the heater. It's been broken since Monday.");
    expect(parsed.date).toBe("2026-09-23T14:05:09.000Z");
  });

  it("falls back to a heading or the first line for notes written elsewhere", () => {
    expect(notes.parseNote("# Trip ideas\n\n- Kyoto\n- Lisbon\n").title).toBe("Trip ideas");
    expect(notes.parseNote("buy oat milk\nand eggs").title).toBe("buy oat milk");
    expect(notes.parseNote("").title).toBe("");
  });

  it("unescapes quotes in a frontmatter title", () => {
    expect(notes.parseNote('---\ntitle: "She said \\"hi\\""\n---\nx').title).toBe('She said "hi"');
  });
});

describe("previewOf", () => {
  it("is the body on one line, without repeating the title, capped", () => {
    const body = "Trip ideas\nKyoto in spring\nLisbon in autumn";
    expect(notes.previewOf({ title: "Trip ideas", body })).toBe("Kyoto in spring Lisbon in autumn");
    expect(notes.previewOf({ title: "t", body: "x".repeat(500) }).length).toBeLessThanOrEqual(141);
  });
});

describe("withBody", () => {
  it("keeps the frontmatter when the body is edited", () => {
    const edited = notes.withBody(fnNote, "Landlord says Thursday.");
    expect(edited.startsWith("---\ntitle:")).toBe(true);
    expect(notes.parseNote(edited).body).toBe("Landlord says Thursday.");
  });

  it("is just the body for a note without frontmatter", () => {
    expect(notes.withBody("old", "new text")).toBe("new text\n");
  });
});

describe("matchesQuery / sortNewestFirst", () => {
  const a = { name: "a.md", title: "Heater", body: "call landlord", mtimeMs: 1 };
  const b = { name: "b.md", title: "买菜", body: "牛奶 鸡蛋", mtimeMs: 2 };

  it("matches title or body, case-insensitively, including Chinese", () => {
    expect(notes.matchesQuery(a, "LANDLORD")).toBe(true);
    expect(notes.matchesQuery(b, "鸡蛋")).toBe(true);
    expect(notes.matchesQuery(a, "eggs")).toBe(false);
    expect(notes.matchesQuery(a, "  ")).toBe(true);
  });

  it("sorts newest first without mutating the input", () => {
    const input = [a, b];
    expect(notes.sortNewestFirst(input).map((n) => n.name)).toEqual(["b.md", "a.md"]);
    expect(input.map((n) => n.name)).toEqual(["a.md", "b.md"]);
  });
});
