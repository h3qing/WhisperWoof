import { describe, it, expect } from "vitest";
import * as clip from "../../bridge/clipboard-pure.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const MB = 1024 * 1024;

describe("copied files", () => {
  it("reads a Finder file URL, spaces and non-ASCII included", () => {
    expect(clip.fileUrlToPath("file:///Users/me/Pictures/My%20Photo.jpg")).toBe("/Users/me/Pictures/My Photo.jpg");
    expect(clip.fileUrlToPath("file:///Users/me/%E7%85%A7%E7%89%87.heic")).toBe("/Users/me/照片.heic");
    expect(clip.fileUrlToPath("https://example.com/a.png")).toBeNull();
    expect(clip.fileUrlToPath("")).toBeNull();
  });

  it("lists every file of a multi-file copy from the filenames plist", () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
  <string>/Users/me/a.png</string>
  <string>/Users/me/Tom &amp; Jerry.jpg</string>
</array></plist>`;
    expect(clip.parseFilenamesPlist(plist)).toEqual(["/Users/me/a.png", "/Users/me/Tom & Jerry.jpg"]);
    expect(clip.parseFilenamesPlist("")).toEqual([]);
  });

  it("recognises photos by extension, any case", () => {
    expect(clip.isImageFile("/x/IMG_0001.HEIC")).toBe(true);
    expect(clip.isImageFile("/x/shot.png")).toBe(true);
    expect(clip.isImageFile("/x/report.pdf")).toBe(false);
    expect(clip.isImageFile("/x/.png")).toBe(false);
  });
});

describe("parseMetadata", () => {
  it("parses the JSON string the database hands out (the view used to miss every image)", () => {
    expect(clip.isImageMetadata('{"type":"image","width":10}')).toBe(true);
    expect(clip.isImageMetadata({ type: "image" })).toBe(true);
    expect(clip.isImageMetadata('{"sourceApp":{"name":"Safari"}}')).toBe(false);
    expect(clip.parseMetadata("not json")).toEqual({});
    expect(clip.parseMetadata(null)).toEqual({});
  });
});

describe("retention", () => {
  const entry = (id: string, age: number, extra: Record<string, unknown> = {}) => ({
    id,
    createdAt: daysAgo(age),
    favorite: 0,
    isImage: false,
    bytes: 0,
    ...extra,
  });

  it("defaults to keeping text forever and images up to 1 GB", () => {
    expect(clip.normalizeRetention(undefined)).toEqual({ keepDays: 0, maxImageMB: 1024 });
    expect(clip.normalizeRetention({ keepDays: 30, maxImageMB: 500 })).toEqual({ keepDays: 30, maxImageMB: 500 });
    expect(clip.normalizeRetention({ keepDays: 3, maxImageMB: -1 })).toEqual({ keepDays: 0, maxImageMB: 1024 });
  });

  it("drops anything older than the kept days, except pinned", () => {
    const entries = [entry("new", 1), entry("old", 40), entry("oldPinned", 40, { favorite: 1 })];
    expect(clip.pickPruneIds(entries, { now: NOW, keepDays: 30, maxImageMB: 0 })).toEqual(["old"]);
  });

  it("keeps nothing extra when history is kept forever and there's no cap", () => {
    const entries = [entry("a", 400), entry("b", 900, { isImage: true, bytes: 5 * MB })];
    expect(clip.pickPruneIds(entries, { now: NOW, keepDays: 0, maxImageMB: 0 })).toEqual([]);
  });

  it("removes the oldest images once images use more than the cap", () => {
    const entries = [
      entry("img1", 1, { isImage: true, bytes: 120 * MB }),
      entry("img2", 2, { isImage: true, bytes: 60 * MB }),
      entry("img3", 3, { isImage: true, bytes: 60 * MB }),
      entry("text", 99),
    ];
    expect(clip.pickPruneIds(entries, { now: NOW, keepDays: 0, maxImageMB: 200 })).toEqual(["img3"]);
  });

  it("counts pinned images towards the cap but never removes them", () => {
    const entries = [
      entry("pinned", 9, { isImage: true, bytes: 150 * MB, favorite: 1 }),
      entry("recent", 1, { isImage: true, bytes: 40 * MB }),
      entry("older", 2, { isImage: true, bytes: 40 * MB }),
    ];
    expect(clip.pickPruneIds(entries, { now: NOW, keepDays: 0, maxImageMB: 200 })).toEqual(["older"]);
  });
});

describe("clear", () => {
  const entries = [
    { id: "t1", createdAt: daysAgo(1), favorite: 0, isImage: false },
    { id: "t9", createdAt: daysAgo(9), favorite: 0, isImage: false },
    { id: "i1", createdAt: daysAgo(1), favorite: 0, isImage: true },
    { id: "i9", createdAt: daysAgo(9), favorite: 0, isImage: true },
    { id: "pin", createdAt: daysAgo(9), favorite: 1, isImage: true },
  ];

  it("clears one kind, or everything, and never a pinned item", () => {
    expect(clip.pickClearIds(entries, { kind: "text", now: NOW })).toEqual(["t1", "t9"]);
    expect(clip.pickClearIds(entries, { kind: "image", now: NOW })).toEqual(["i1", "i9"]);
    expect(clip.pickClearIds(entries, { kind: "all", now: NOW })).toEqual(["t1", "t9", "i1", "i9"]);
  });

  it("clears only older items when asked", () => {
    expect(clip.pickClearIds(entries, { kind: "all", olderThanDays: 7, now: NOW })).toEqual(["t9", "i9"]);
  });
});

describe("notes from clipboard images", () => {
  it("links the attachment from the note body", () => {
    expect(clip.imageNoteBody("attachments/clip-1.png")).toBe("![Clipboard image](attachments/clip-1.png)");
    expect(clip.attachmentFileName("2026-09-25-120000", ".JPG")).toBe("2026-09-25-120000.jpg");
    expect(clip.attachmentFileName("a b", ".exe;rm")).toBe("a-b.png");
  });

  it("only shows attachments inside the notes folder's attachments/", () => {
    const body = [
      "![Clipboard image](attachments/a.png)",
      "![x](../../etc/passwd.png)",
      "![y](attachments/../secret.png)",
      "![z](attachments/notes.md)",
      "![again](attachments/a.png)",
      "![spaced](attachments/My%20Shot.jpg)",
    ].join("\n");
    expect(clip.noteImageRefs(body)).toEqual(["attachments/a.png", "attachments/My Shot.jpg"]);
  });
});

describe("formatBytes", () => {
  it("reads like a person would say it", () => {
    expect(clip.formatBytes(512)).toBe("512 B");
    expect(clip.formatBytes(40 * 1024)).toBe("40 KB");
    expect(clip.formatBytes(3.4 * MB)).toBe("3.4 MB");
    expect(clip.formatBytes(312 * MB)).toBe("312 MB");
    expect(clip.formatBytes(1536 * MB)).toBe("1.5 GB");
  });
});

describe("note attachments: renderer and main process agree", async () => {
  const { noteImageRefs: rendererRefs, withoutImageLinks } = await import("../../ui/notes/note-attachments");
  const bodies = [
    "![Clipboard image](attachments/a.png)\nsome text\n![b](attachments/b%20c.JPG)",
    "![x](../outside.png) ![y](attachments/../x.png) ![z](attachments/.hidden.png)",
    "![bad](attachments/%E0%A4%A.png) ![ok](attachments/ok.webp)",
    "no images here",
  ];
  it("pick the same attachments (the main process only reads what the view asks for)", () => {
    for (const body of bodies) expect(rendererRefs(body)).toEqual(clip.noteImageRefs(body));
  });
  it("previews say Image instead of Markdown syntax", () => {
    expect(withoutImageLinks("![Clipboard image](attachments/a.png)")).toBe("Image");
  });
});
