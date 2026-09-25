import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { redactContent } = require("../../bridge/vault/log-redact-pure.js");

describe("redactContent (debug log lines while encryption is on)", () => {
  it("replaces what the user said, typed or wrote with its length", () => {
    const meta = {
      textPreview: "call the landlord",
      responsePreview: '{"text":"secret"}',
      prompt: "Heqing, WhisperWoof",
      newFieldValue: "typed in another app",
      goal: "finish the tax return",
      text: "hello",
    };
    expect(redactContent(meta)).toEqual({
      textPreview: "[17 chars]",
      responsePreview: "[17 chars]",
      prompt: "[19 chars]",
      newFieldValue: "[20 chars]",
      goal: "[21 chars]",
      text: "[5 chars]",
    });
  });

  it("keeps numbers, flags, ids, paths and errors", () => {
    const meta = { textLength: 42, hasText: true, id: "e1", filePath: "/x/y.md", error: "ENOENT", durationMs: 12 };
    expect(redactContent(meta)).toEqual(meta);
  });

  it("goes into nested objects and arrays, without mutating the input", () => {
    const meta = { entry: { rawText: "secret", source: "voice" }, words: ["a", "b"], segments: [{ transcript: "hi" }] };
    const out = redactContent(meta);
    expect(out).toEqual({ entry: { rawText: "[6 chars]", source: "voice" }, words: "[2 items]", segments: [{ transcript: "[2 chars]" }] });
    expect(meta.entry.rawText).toBe("secret");
  });

  it("leaves non-objects alone and survives cycles", () => {
    expect(redactContent(undefined)).toBeUndefined();
    expect(redactContent("a message")).toBe("a message");
    const cyclic: Record<string, unknown> = { text: "x" };
    cyclic.self = cyclic;
    expect(redactContent(cyclic)).toEqual({ text: "[1 chars]", self: "[cycle]" });
  });
});
