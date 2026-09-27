import { describe, it, expect } from "vitest";
import * as rules from "../../bridge/clipboard-image-text-pure.js";

const calm = {
  enabled: true,
  available: true,
  dbOpen: true,
  hasFresh: false,
  hasBacklog: true,
  now: 1_000_000,
  holdUntil: 0,
  meetingRecording: false,
  thermal: "nominal",
  onBattery: false,
  loadRatio: 0.2,
};

describe("the setting", () => {
  it("is off unless turned on", () => {
    expect(rules.normalizeImageText(undefined)).toEqual({ enabled: false });
    expect(rules.normalizeImageText({ enabled: "yes" })).toEqual({ enabled: false });
    expect(rules.normalizeImageText({ enabled: true })).toEqual({ enabled: true });
  });
});

describe("decidePace", () => {
  it("reads older images when the Mac is calm and plugged in", () => {
    expect(rules.decidePace(calm)).toMatchObject({ run: true, freshOnly: false, state: "reading" });
  });

  it("does nothing when off, unavailable or finished", () => {
    expect(rules.decidePace({ ...calm, enabled: false })).toMatchObject({ run: false, state: "off" });
    expect(rules.decidePace({ ...calm, available: false })).toMatchObject({ run: false, state: "unavailable" });
    expect(rules.decidePace({ ...calm, hasBacklog: false })).toMatchObject({ run: false, state: "done" });
  });

  it("waits while locked, for the database to open again", () => {
    expect(rules.decidePace({ ...calm, dbOpen: false })).toMatchObject({ run: false, state: "paused", reason: "locked", retryMs: null });
  });

  it("steps aside while the user dictates, until the hold-off ends", () => {
    const d = rules.decidePace({ ...calm, hasFresh: true, holdUntil: calm.now + 5000 });
    expect(d).toMatchObject({ run: false, state: "paused", reason: "dictating" });
    expect(d.retryMs).toBeGreaterThanOrEqual(5000);
  });

  it("waits while a meeting records, the Mac is hot or busy", () => {
    expect(rules.decidePace({ ...calm, meetingRecording: true }).reason).toBe("meeting");
    expect(rules.decidePace({ ...calm, thermal: "serious" }).reason).toBe("hot");
    expect(rules.decidePace({ ...calm, thermal: "critical" }).reason).toBe("hot");
    expect(rules.decidePace({ ...calm, thermal: "fair" }).run).toBe(true);
    expect(rules.decidePace({ ...calm, loadRatio: rules.BUSY_LOAD_RATIO }).reason).toBe("busy");
  });

  it("on battery reads only new copies; older images wait for the charger", () => {
    expect(rules.decidePace({ ...calm, onBattery: true })).toMatchObject({ run: false, state: "paused", reason: "battery" });
    expect(rules.decidePace({ ...calm, onBattery: true, hasFresh: true })).toMatchObject({ run: true, freshOnly: true });
  });
});

describe("restAfter", () => {
  it("gives new copies a short rest", () => {
    expect(rules.restAfter(900, { fresh: true })).toBe(200);
  });

  it("keeps the helper busy at most half the time, a third while the user is active", () => {
    expect(rules.restAfter(800, {})).toBe(800);
    expect(rules.restAfter(800, { userActive: true })).toBe(1600);
    expect(rules.restAfter(50, {})).toBe(400);
    expect(rules.restAfter(60_000, {})).toBe(10_000);
  });
});

describe("ocrLanguages", () => {
  it("puts Chinese first (its model reads English too) and always adds English", () => {
    expect(rules.ocrLanguages(["en-US", "zh-Hans-CN"])).toEqual(["zh-Hans", "en-US"]);
    expect(rules.ocrLanguages(["zh-Hant-TW", "zh-Hans"])).toEqual(["zh-Hant", "zh-Hans", "en-US"]);
    expect(rules.ocrLanguages(["de-DE", "fr-CA"])).toEqual(["de-DE", "fr-FR", "en-US"]);
    expect(rules.ocrLanguages(["xx", "en-GB", "en-US"])).toEqual(["en-US"]);
    expect(rules.ocrLanguages(undefined)).toEqual(["en-US"]);
  });

  it("maps system language tags to Vision's names", () => {
    expect(rules.visionLanguage("zh-HK")).toBe("zh-Hant");
    expect(rules.visionLanguage("zh")).toBe("zh-Hans");
    expect(rules.visionLanguage("ja-JP")).toBe("ja-JP");
    expect(rules.visionLanguage("vi")).toBe("vi-VT");
    expect(rules.visionLanguage("nl-NL")).toBeNull();
  });
});

describe("helper wire format", () => {
  it("prefixes each image with its length, big-endian", () => {
    expect([...rules.frameHeader(0x01020304)]).toEqual([1, 2, 3, 4]);
    expect([...rules.frameHeader(5)]).toEqual([0, 0, 0, 5]);
  });

  it("reads answers, and treats anything odd as a failure", () => {
    expect(rules.parseHelperAnswer('{"text":"Hello\\n  world ","lines":2}')).toEqual({ text: "Hello\nworld" });
    expect(rules.parseHelperAnswer('{"error":"unreadable","message":"x"}')).toEqual({ error: "unreadable" });
    expect(rules.parseHelperAnswer('{"error":"boom"}')).toEqual({ error: "failed" });
    expect(rules.parseHelperAnswer("not json")).toEqual({ error: "failed" });
    expect(rules.parseHelperAnswer("null")).toEqual({ error: "failed" });
    expect(rules.parseHelperAnswer('{"text":5}')).toEqual({ error: "failed" });
    expect(rules.parseHelperAnswer('{"ready":true,"languages":["en-US"]}')).toEqual({ ready: true });
  });
});

describe("cleanRecognizedText", () => {
  it("drops blank lines and control characters", () => {
    expect(rules.cleanRecognizedText("a\r\n\r\n  b\u0000c \t d\n")).toBe("a\nb c d");
  });

  it("caps what's stored, without splitting a character", () => {
    const long = "字".repeat(rules.MAX_TEXT_CHARS + 10);
    expect(rules.cleanRecognizedText(long)).toHaveLength(rules.MAX_TEXT_CHARS);
    const emoji = `${"a".repeat(rules.MAX_TEXT_CHARS - 1)}😀`;
    expect(rules.cleanRecognizedText(emoji)).toBe("a".repeat(rules.MAX_TEXT_CHARS - 1));
  });
});

describe("matchSnippet", () => {
  it("shows the words around the match, any case", () => {
    const text = "The real bottleneck was the database, not the network layer at all";
    expect(rules.matchSnippet(text, "BOTTLENECK", 5)).toEqual({ before: "…real ", match: "bottleneck", after: " was…" });
    expect(rules.matchSnippet(text, "the real", 5)).toEqual({ before: "", match: "The real", after: " bott…" });
  });

  it("works for Chinese and flattens line breaks", () => {
    expect(rules.matchSnippet("看看到底\n哪个是bottleneck", "哪个", 4)).toEqual({ before: "…看到底 ", match: "哪个", after: "是bot…" });
  });

  it("is null when there's no match or no query", () => {
    expect(rules.matchSnippet("hello", "bye")).toBeNull();
    expect(rules.matchSnippet("hello", "  ")).toBeNull();
    expect(rules.matchSnippet("", "a")).toBeNull();
  });

  it("never cuts an emoji in half", () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    // The window would start inside the emoji: it widens to take all of it.
    expect(rules.matchSnippet("a😀cd match", "match", 4)?.before).toBe("…😀cd ");
    expect(rules.matchSnippet("match cd😀z", "match", 4)?.after).toBe(" cd😀…");
    for (const radius of [1, 2, 3, 4, 5, 6]) {
      const s = rules.matchSnippet("x😀😀 match 😀😀x", "match", radius);
      expect(`${s?.before}${s?.after}`).not.toMatch(lone);
    }
  });
});
