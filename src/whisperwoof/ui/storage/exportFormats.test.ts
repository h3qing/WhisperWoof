import { describe, it, expect } from "vitest";
import {
  EXPORT_EXTENSIONS,
  EXPORT_MIME_TYPES,
  exportFilename,
  formatEntries,
  formatEntriesAsJson,
  formatEntriesAsTxt,
  type ExportableEntry,
} from "./exportFormats";

const sampleEntry: ExportableEntry = {
  id: "abc123",
  createdAt: "2026-05-04T10:00:00.000Z",
  source: "voice",
  rawText: "this is the raw text um you know",
  polished: "This is the polished text.",
  routedTo: "paste-at-cursor",
  hotkeyUsed: "Fn",
  durationMs: 4200,
  projectId: null,
  audioPath: "/tmp/abc.wav",
  metadata: { foo: "bar" },
  favorite: 0,
};

const polishedOnly: ExportableEntry = {
  id: "p1",
  createdAt: "2026-05-04T10:01:00.000Z",
  source: "voice",
  rawText: "",
  polished: "Polished only.",
};

const rawOnly: ExportableEntry = {
  id: "r1",
  createdAt: "2026-05-04T10:02:00.000Z",
  source: "clipboard",
  rawText: "Raw only.",
  polished: null,
};

const samePolishedAsRaw: ExportableEntry = {
  id: "s1",
  rawText: "Identical text.",
  polished: "Identical text.",
};

describe("formatEntriesAsJson", () => {
  it("emits valid JSON that round-trips", () => {
    const out = formatEntriesAsJson([sampleEntry]);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([sampleEntry]);
  });

  it("emits pretty-printed JSON with 2-space indent (regression)", () => {
    const out = formatEntriesAsJson([sampleEntry]);
    expect(out).toContain('  "id"');
  });

  it("returns [] for empty input", () => {
    expect(JSON.parse(formatEntriesAsJson([]))).toEqual([]);
  });
});

describe("formatEntriesAsTxt", () => {
  it("returns '' for empty input", () => {
    expect(formatEntriesAsTxt([])).toBe("");
  });

  it("includes timestamp, source, and hotkey in header", () => {
    const out = formatEntriesAsTxt([sampleEntry]);
    expect(out).toContain("2026-05-04T10:00:00.000Z");
    expect(out).toContain("[voice]");
    expect(out).toContain("(Fn)");
  });

  it("emits both polished and raw when they differ", () => {
    const out = formatEntriesAsTxt([sampleEntry]);
    expect(out).toContain("Polished:");
    expect(out).toContain("This is the polished text.");
    expect(out).toContain("Raw:");
    expect(out).toContain("this is the raw text um you know");
  });

  it("emits only polished when raw is empty", () => {
    const out = formatEntriesAsTxt([polishedOnly]);
    expect(out).toContain("Polished only.");
    expect(out).not.toContain("Raw:");
    expect(out).not.toContain("Polished:");
  });

  it("emits only raw when polished is null", () => {
    const out = formatEntriesAsTxt([rawOnly]);
    expect(out).toContain("Raw only.");
    expect(out).not.toContain("Raw:");
    expect(out).not.toContain("Polished:");
  });

  it("collapses identical polished/raw to a single block", () => {
    const out = formatEntriesAsTxt([samePolishedAsRaw]);
    expect(out).toContain("Identical text.");
    expect(out.match(/Identical text\./g)?.length).toBe(1);
    expect(out).not.toContain("Polished:");
    expect(out).not.toContain("Raw:");
  });

  it("separates multiple entries with the divider", () => {
    const out = formatEntriesAsTxt([polishedOnly, rawOnly]);
    expect(out).toContain("\n----\n");
    expect(out).toContain("Polished only.");
    expect(out).toContain("Raw only.");
  });

  it("ends with a trailing newline so editors do not complain", () => {
    const out = formatEntriesAsTxt([polishedOnly]);
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("formatEntries dispatch", () => {
  it("routes json format to JSON serializer", () => {
    const out = formatEntries([sampleEntry], "json");
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("routes txt format to TXT serializer", () => {
    const out = formatEntries([sampleEntry], "txt");
    expect(out).toContain("[voice]");
  });
});

describe("filename + mime metadata", () => {
  it("dates filenames with YYYY-MM-DD", () => {
    const date = new Date("2026-05-04T17:23:45Z");
    expect(exportFilename("json", date)).toBe("whisperwoof-export-2026-05-04.json");
    expect(exportFilename("txt", date)).toBe("whisperwoof-export-2026-05-04.txt");
  });

  it("declares correct mime types", () => {
    expect(EXPORT_MIME_TYPES.json).toBe("application/json");
    expect(EXPORT_MIME_TYPES.txt).toBe("text/plain;charset=utf-8");
  });

  it("declares correct extensions", () => {
    expect(EXPORT_EXTENSIONS.json).toBe("json");
    expect(EXPORT_EXTENSIONS.txt).toBe("txt");
  });
});
