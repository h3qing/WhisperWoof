import { describe, it, expect } from "vitest";
import type { Entry } from "../../core/storage/types";
import type { ClipboardItem } from "../smart-clipboard/clipboard-view";
import {
  buildSections,
  enterLabel,
  flattenRows,
  isCommandInput,
  moveSelection,
  noResultsLine,
  paletteHint,
  searchMeetingNotes,
  searchNoteDocs,
  snippetAround,
  type EverythingResults,
} from "./search-palette";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const entry = (id: string, source = "voice"): Entry =>
  ({ id, source, createdAt: ago(5), rawText: "x", polished: null } as unknown as Entry);

const clip = (id: string, over: Partial<ClipboardItem> = {}): ClipboardItem => ({
  id,
  createdAt: ago(10),
  pinned: false,
  kind: "text",
  text: "",
  fileName: null,
  width: null,
  height: null,
  sourceApp: "Messages",
  ...over,
});

const none = { items: [], more: false };

function results(over: Partial<EverythingResults> = {}): EverythingResults {
  return {
    query: "bottleneck",
    history: none,
    clipboard: none,
    images: none,
    files: none,
    imageText: { enabled: true, available: true },
    ...over,
  };
}

describe("buildSections", () => {
  it("lists History, Notes, meeting notes, Clipboard, then images, and leaves out empty groups", () => {
    const sections = buildSections({
      query: "bottleneck",
      now: NOW,
      results: results({
        history: {
          items: [{ id: "h1", source: "meeting", createdAt: ago(5), text: "the bottleneck", snippet: { before: "the ", match: "bottleneck", after: "" }, entry: entry("h1", "meeting") }],
          more: true,
        },
        clipboard: { items: [{ ...clip("c1", { text: "copied bottleneck" }), snippet: null }], more: false },
        images: { items: [clip("i1", { kind: "image", width: 1678, height: 1118, textMatch: { before: "…real ", match: "bottleneck", after: " was" } })], more: false },
      }),
      notes: searchNoteDocs([{ name: "perf.md", title: "Perf", body: "The bottleneck is the DB", mtimeMs: NOW - 3_600_000 }], "bottleneck"),
    });
    expect(sections.map((s) => s.title)).toEqual(["History", "Notes", "Clipboard", "Images"]);

    const [history, notes, clipboard, images] = sections;
    expect(history.rows[0]).toMatchObject({ icon: "meeting", meta: "Meeting · 5 min ago", matchIsTitle: true, action: { kind: "open-history" } });
    expect(history.rows[1]).toMatchObject({ icon: "more", title: "Show all in History", action: { kind: "show-all", view: "history", query: "bottleneck" } });
    expect(notes.rows[0]).toMatchObject({ title: "Perf", meta: "1 h ago", action: { kind: "open-note", name: "perf.md" } });
    expect(notes.rows[0].match).toMatchObject({ match: "bottleneck" });
    expect(clipboard.rows[0]).toMatchObject({
      meta: "Copied text · Messages · 10 min ago",
      action: { kind: "copy", id: "c1", what: "text" },
      alt: { kind: "show-all", view: "clipboard" },
    });
    expect(images.rows[0]).toMatchObject({ title: "1678×1118", imageId: "i1", meta: "Words in image · Messages · 10 min ago", action: { what: "image" } });
  });

  it("ignores results for an older query and shows nothing for an empty box", () => {
    const stale = results({ query: "bottle", history: { items: [{ id: "h", source: "voice", createdAt: ago(1), text: "bottle", snippet: null, entry: entry("h") }], more: false } });
    expect(buildSections({ query: "bottleneck", results: stale, now: NOW })).toEqual([]);
    expect(buildSections({ query: "  ", results: results(), now: NOW })).toEqual([]);
  });

  it("puts kept files with images, and one Show all for both", () => {
    const sections = buildSections({
      query: "bottleneck",
      now: NOW,
      results: results({
        images: { items: [clip("i1", { kind: "image", fileName: "bottleneck.png" })], more: false },
        files: { items: [clip("f1", { kind: "file", fileName: "bottleneck.pdf" })], more: true },
      }),
    });
    expect(sections.map((s) => s.title)).toEqual(["Images and files"]);
    expect(sections[0].rows.map((r) => r.title)).toEqual(["bottleneck.png", "bottleneck.pdf", "Show all in Clipboard"]);
    expect(sections[0].rows[1]).toMatchObject({ icon: "file", meta: "File · Messages · 10 min ago", action: { what: "file" } });
  });

  it("labels meeting and imported-audio notes, with SQLite's UTC dates", () => {
    const meetings = searchMeetingNotes(
      [
        { id: 1, title: "Weekly sync", content: "latency bottleneck", note_type: "meeting", updated_at: "2026-09-27 11:00:00" },
        { id: 2, title: "Interview.m4a", content: "the bottleneck", note_type: "upload", updated_at: "2026-09-27 11:30:00" },
      ],
      "bottleneck"
    );
    const [section] = buildSections({ query: "bottleneck", results: results(), meetingNotes: meetings, now: NOW });
    expect(section.title).toBe("Meeting notes");
    expect(section.rows.map((r) => r.meta)).toEqual(["Meeting · 1 h ago", "Imported audio · 30 min ago"]);
    expect(section.rows[0].action).toEqual({ kind: "open-meeting-note", id: 1 });
  });
});

describe("searching notes here", () => {
  const notes = [
    { name: "a.md", title: "Bottleneck ideas", body: "nothing", mtimeMs: 3 },
    { name: "b.md", title: "Other", body: "我让他看看到底哪个是bottleneck", mtimeMs: 2 },
    { name: "c.md", title: "Third", body: "unrelated", mtimeMs: 1 },
  ];
  it("matches title or text, any case; a title match needs no snippet", () => {
    const hits = searchNoteDocs(notes, "BOTTLENECK");
    expect(hits.items.map((h) => h.doc.name)).toEqual(["a.md", "b.md"]);
    expect(hits.items[0].match).toBeNull();
    expect(hits.items[1].match?.match).toBe("bottleneck");
    expect(searchNoteDocs(notes, "哪个").items.map((h) => h.doc.name)).toEqual(["b.md"]);
  });
  it("caps the group and says there are more", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `${i}.md`, title: `t${i}`, body: "same words", mtimeMs: i }));
    expect(searchNoteDocs(many, "same", 5)).toMatchObject({ more: true });
    expect(searchNoteDocs(many, "same", 5).items).toHaveLength(5);
    expect(searchNoteDocs(many, " ").items).toEqual([]);
  });
});

describe("the palette's words and keys", () => {
  it("turns into the command bar after a slash", () => {
    expect(isCommandInput("/note hi")).toBe(true);
    expect(isCommandInput("  /")).toBe(true);
    expect(isCommandInput("a/b")).toBe(false);
  });

  it("moves the selection and stops at both ends", () => {
    expect(moveSelection(0, -1, 5)).toBe(0);
    expect(moveSelection(0, 1, 5)).toBe(1);
    expect(moveSelection(4, 1, 5)).toBe(4);
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(3, 1, 0)).toBe(0);
  });

  it("says what it searches, and where else to look when nothing matches", () => {
    expect(paletteHint({ enabled: true })).toBe("Search your history, notes, clipboard and the words in your images.");
    expect(paletteHint(null)).toBe("Search your history, notes and clipboard.");
    expect(noResultsLine(" zebra ", { enabled: false, available: true })).toBe(
      "Nothing matches “zebra”. To search the words in screenshots too, turn on Words in images in Clipboard."
    );
    expect(noResultsLine("zebra", { enabled: true, available: true })).toBe("Nothing matches “zebra”.");
    expect(noResultsLine("zebra", { enabled: false, available: false })).toBe("Nothing matches “zebra”.");
  });

  it("names what Enter does", () => {
    const rows = flattenRows(
      buildSections({
        query: "bottleneck",
        now: NOW,
        results: results({
          clipboard: { items: [clip("c", { text: "bottleneck" })], more: false },
          images: { items: [clip("i", { kind: "image" })], more: false },
        }),
      })
    );
    expect(rows.map(enterLabel)).toEqual(["Copy", "Copy image"]);
    expect(enterLabel(null)).toBe("Open");
  });

  it("cuts snippets like the main process", () => {
    expect(snippetAround("The real bottleneck was the database", "BOTTLENECK", 5)).toEqual({
      before: "…real ",
      match: "bottleneck",
      after: " was…",
    });
    expect(snippetAround("hello", "bye")).toBeNull();
  });
});
