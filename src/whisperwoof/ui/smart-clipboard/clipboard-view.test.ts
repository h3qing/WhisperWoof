import { describe, it, expect } from "vitest";
import {
  clipboardHeadline,
  relativeTime,
  imageCaption,
  clearQuestion,
  clearOptions,
  formatBytes,
  type ClipboardSummary,
  type ClipboardItem,
} from "./clipboard-view";

const summary = (over: Partial<ClipboardSummary> = {}): ClipboardSummary => ({
  textCount: 0,
  imageCount: 0,
  pinnedCount: 0,
  imageBytes: 0,
  retention: { keepDays: 0, maxImageMB: 1024 },
  ...over,
});

describe("clipboardHeadline", () => {
  it("opens with what's kept and what images cost on disk", () => {
    expect(clipboardHeadline(summary({ textCount: 1204, imageCount: 86, imageBytes: 312 * 1024 * 1024 }))).toBe(
      "1,204 texts and 86 images copied. Images take up 312 MB."
    );
  });

  it("uses the singular and skips disk when there are no images", () => {
    expect(clipboardHeadline(summary({ textCount: 1 }))).toBe("1 text and 0 images copied.");
    expect(clipboardHeadline(summary({ textCount: 0, imageCount: 1, imageBytes: 2048 }))).toBe(
      "0 texts and 1 image copied. Images take up 2 KB."
    );
  });

  it("says so when nothing is there", () => {
    expect(clipboardHeadline(summary())).toBe("Nothing copied yet.");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-25T15:00:00");
  it("reads naturally", () => {
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe("Just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 min ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-09-24T09:30:00").toISOString(), now)).toBe("Yesterday 9:30 AM");
    expect(relativeTime(new Date("2026-09-02T09:30:00").toISOString(), now)).toBe("Sep 2");
    expect(relativeTime(new Date("2025-12-31T09:30:00").toISOString(), now)).toBe("Dec 31, 2025");
    expect(relativeTime("nope", now)).toBe("");
  });
});

describe("imageCaption", () => {
  const item = (over: Partial<ClipboardItem>): ClipboardItem => ({
    id: "1",
    createdAt: "",
    pinned: false,
    kind: "image",
    text: "",
    fileName: null,
    width: 1920,
    height: 1080,
    sourceApp: null,
    ...over,
  });
  it("prefers the photo's file name, then its size", () => {
    expect(imageCaption(item({ fileName: "IMG_0042.HEIC" }))).toBe("IMG_0042.HEIC");
    expect(imageCaption(item({}))).toBe("1920×1080");
    expect(imageCaption(item({ width: null, height: null }))).toBe("Image");
  });
});

describe("clear", () => {
  const s = summary({ textCount: 12, imageCount: 3, imageBytes: 5 * 1024 * 1024 });
  it("asks in plain words, naming how much goes", () => {
    expect(clearQuestion("text", s)).toBe("Remove 12 texts?");
    expect(clearQuestion("image", s)).toBe("Remove 3 images (5.0 MB)?");
    expect(clearQuestion("older", s)).toBe("Remove everything copied more than a week ago?");
    expect(clearQuestion("all", s)).toBe("Remove everything in your clipboard history?");
  });
  it("maps each choice to what the store clears", () => {
    expect(clearOptions("older")).toEqual({ kind: "all", olderThanDays: 7 });
    expect(clearOptions("image")).toEqual({ kind: "image", olderThanDays: 0 });
  });
  it("formats sizes like the store", () => {
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});
