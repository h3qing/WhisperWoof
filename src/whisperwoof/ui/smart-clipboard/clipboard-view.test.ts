import { describe, it, expect } from "vitest";
import {
  clipboardHeadline,
  relativeTime,
  imageCaption,
  clearQuestion,
  clearOptions,
  formatBytes,
  fileBadge,
  imageTextConsent,
  imageTextLine,
  imageTextOffQuestion,
  type ClipboardSummary,
  type ClipboardItem,
  type ImageTextStatus,
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

  it("adds kept files, and what images and files take together", () => {
    expect(
      clipboardHeadline(summary({ textCount: 5, imageCount: 2, imageBytes: 10 * 1024 * 1024, fileCount: 3, fileBytes: 20 * 1024 * 1024 }))
    ).toBe("5 texts, 2 images and 3 files copied. Images and files take up 30 MB.");
    expect(clipboardHeadline(summary({ textCount: 1, fileCount: 1, fileBytes: 2 * 1024 * 1024 }))).toBe(
      "1 text, 0 images and 1 file copied. The file takes up 2.0 MB."
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
  it("asks about kept files in their own words", () => {
    expect(clearQuestion("file", summary({ fileCount: 2, fileBytes: 3 * 1024 * 1024 }))).toBe("Remove 2 files (3.0 MB)?");
    expect(clearOptions("file")).toEqual({ kind: "file", olderThanDays: 0 });
    expect(fileBadge("Q3 plan.pdf")).toBe("PDF");
    expect(fileBadge("archive.tar.gz")).toBe("GZ");
    expect(fileBadge("README")).toBe("FILE");
  });
  it("maps each choice to what the store clears", () => {
    expect(clearOptions("older")).toEqual({ kind: "all", olderThanDays: 7 });
    expect(clearOptions("image")).toEqual({ kind: "image", olderThanDays: 0 });
  });
  it("formats sizes like the store", () => {
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("words in images", () => {
  const status = (over: Partial<ImageTextStatus> = {}): ImageTextStatus => ({
    enabled: true,
    available: true,
    encrypted: false,
    state: "reading",
    reason: null,
    total: 13179,
    read: 2340,
    withText: 1200,
    ...over,
  });

  it("asks first, saying why, how, what it costs and what it means for privacy", () => {
    const plain = imageTextConsent({ imageCount: 13179, encrypted: false });
    expect(plain.question).toBe("Read the words in your images so search can find them?");
    expect(plain.confirm).toBe("Read words in images");
    const all = plain.points.join(" ");
    expect(all).toContain("on this Mac. Nothing is uploaded or downloaded.");
    expect(all).toContain("Your 13,179 older images are read in the background, newest first, only while your Mac is plugged in.");
    expect(all).toContain("waits while you dictate or record a meeting");
    expect(all).toContain("as plain text");
    expect(all).toContain("a password too, becomes text search can find");
    expect(all).toContain("reading stops and the words are deleted. Your images stay.");
    const locked = imageTextConsent({ imageCount: 1, encrypted: true }).points.join(" ");
    expect(locked).toContain("encrypted like it");
    expect(locked).toContain("Your 1 older image is read");
    expect(imageTextConsent({ imageCount: 0, encrypted: false }).points.join(" ")).not.toContain("older");
  });

  it("says what turning it off deletes", () => {
    expect(imageTextOffQuestion({ read: 2340 })).toBe(
      "Stop reading words in images? The words read from 2,340 images are deleted. Your images stay."
    );
    expect(imageTextOffQuestion({ read: 0 })).toBe("Stop reading words in images?");
  });

  it("shows progress, why it waits, and what it found", () => {
    expect(imageTextLine(status())).toBe("Reading the words in your images: 2,340 of 13,179 done.");
    expect(imageTextLine(status({ state: "paused", reason: "battery" }))).toBe(
      "Reading the words in your images: 2,340 of 13,179 done. The rest are read when your Mac is plugged in."
    );
    expect(imageTextLine(status({ state: "paused", reason: "dictating" }))).toContain("Paused while you dictate.");
    expect(imageTextLine(status({ state: "done", read: 13179, withText: 4210 }))).toBe(
      "Words found in 4,210 of 13,179 images. Search finds them."
    );
    expect(imageTextLine(status({ total: 0, read: 0 }))).toBe("Images you copy are read for words a few seconds later.");
    expect(imageTextLine(status({ state: "unavailable" }))).toBe("Words in images can\u2019t be read on this computer.");
    expect(imageTextLine(status({ enabled: false, state: "off" }))).toBeNull();
  });
});
