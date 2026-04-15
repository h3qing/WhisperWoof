/**
 * Tests for Voice Editing Commands — command detection and prompt building.
 *
 * Imports `detectCommand` and `COMMAND_PATTERNS` directly from the real
 * bridge/voice-commands.js module so drift between tested and production
 * regex patterns is impossible. The Ollama execution path
 * (`executeVoiceCommand`) is a network call wrapped around these and is
 * out of scope here.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { detectCommand, COMMAND_PATTERNS, getAvailableCommands } from "../../bridge/voice-commands";

describe("detectCommand", () => {
  it('detects "rewrite" commands', () => {
    expect(detectCommand("rewrite this")?.id).toBe("rewrite");
    expect(detectCommand("Rephrase that")?.id).toBe("rewrite");
    expect(detectCommand("reword it to be clearer")?.id).toBe("rewrite");
  });

  it('detects "make" commands (generic — after specific patterns)', () => {
    expect(detectCommand("make this more formal")?.id).toBe("make");
    expect(detectCommand("make that more casual")?.id).toBe("make");
    expect(detectCommand("make this professional")?.id).toBe("make");
  });

  it('detects "translate" commands', () => {
    expect(detectCommand("translate this to Spanish")?.id).toBe("translate");
    expect(detectCommand("Translate to French")?.id).toBe("translate");
    expect(detectCommand("translate it into Japanese")?.id).toBe("translate");
  });

  it('detects "summarize" commands', () => {
    expect(detectCommand("summarize this")?.id).toBe("summarize");
    expect(detectCommand("Summarise")?.id).toBe("summarize");
    expect(detectCommand("sum up")?.id).toBe("summarize");
    expect(detectCommand("TLDR")?.id).toBe("summarize");
    expect(detectCommand("give me a summary")?.id).toBe("summarize");
  });

  it('detects "fix" commands', () => {
    expect(detectCommand("fix the grammar")?.id).toBe("fix");
    expect(detectCommand("Fix spelling")?.id).toBe("fix");
    expect(detectCommand("correct the errors")?.id).toBe("fix");
    expect(detectCommand("fix typos")?.id).toBe("fix");
    expect(detectCommand("fix this")?.id).toBe("fix");
  });

  it('detects "shorten" commands (including "make this shorter")', () => {
    expect(detectCommand("shorten this")?.id).toBe("shorten");
    expect(detectCommand("make this shorter")?.id).toBe("shorten");
    expect(detectCommand("condense")?.id).toBe("shorten");
    expect(detectCommand("trim")?.id).toBe("shorten");
    expect(detectCommand("cut down")?.id).toBe("shorten");
  });

  it('detects "expand" commands (including "make this longer")', () => {
    expect(detectCommand("expand this")?.id).toBe("expand");
    expect(detectCommand("elaborate")?.id).toBe("expand");
    expect(detectCommand("make this longer")?.id).toBe("expand");
    expect(detectCommand("make it more detailed")?.id).toBe("expand");
  });

  it('detects "format-list" commands', () => {
    expect(detectCommand("format this as a list")?.id).toBe("format-list");
    expect(detectCommand("turn it into bullet points")?.id).toBe("format-list");
    expect(detectCommand("convert to a numbered list")?.id).toBe("format-list");
  });

  it('detects "format-email" commands', () => {
    expect(detectCommand("format this as an email")?.id).toBe("format-email");
    expect(detectCommand("turn this into an email")?.id).toBe("format-email");
    expect(detectCommand("write this as email")?.id).toBe("format-email");
  });

  it('detects "simplify" commands (including "make this simpler")', () => {
    expect(detectCommand("simplify this")?.id).toBe("simplify");
    expect(detectCommand("make this simpler")?.id).toBe("simplify");
    expect(detectCommand("explain this simply")?.id).toBe("simplify");
  });

  it("returns null for regular dictation text", () => {
    expect(detectCommand("I need to buy groceries")).toBeNull();
    expect(detectCommand("The meeting is at 3pm")).toBeNull();
    expect(detectCommand("Hello world")).toBeNull();
    expect(detectCommand("Schedule a call for tomorrow")).toBeNull();
  });

  it("returns null for empty / short input", () => {
    expect(detectCommand("")).toBeNull();
    expect(detectCommand(null)).toBeNull();
    expect(detectCommand("hi")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectCommand("REWRITE THIS")?.id).toBe("rewrite");
    expect(detectCommand("Translate To Spanish")?.id).toBe("translate");
    expect(detectCommand("SUMMARIZE")?.id).toBe("summarize");
  });

  it("preserves full spoken text in match", () => {
    const cmd = detectCommand("make this more formal and concise");
    expect(cmd?.id).toBe("make");
    expect(cmd?.spoken).toBe("make this more formal and concise");
  });

  it("returns a usable buildPrompt function on the matched command", () => {
    const cmd = detectCommand("make this more formal");
    expect(typeof cmd?.buildPrompt).toBe("function");
    const { system, user } = cmd!.buildPrompt(cmd!.spoken, "Hey what's up");
    expect(system).toContain("more formal");
    expect(user).toBe("Hey what's up");
  });
});

describe("COMMAND_PATTERNS registry", () => {
  it("has 10 command types", () => {
    expect(COMMAND_PATTERNS).toHaveLength(10);
  });

  it("all pattern IDs are unique", () => {
    const ids = COMMAND_PATTERNS.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every pattern carries a regex and a buildPrompt function", () => {
    for (const p of COMMAND_PATTERNS) {
      expect(p.match).toBeInstanceOf(RegExp);
      expect(typeof p.buildPrompt).toBe("function");
    }
  });
});

describe("getAvailableCommands", () => {
  it("returns one entry per registered command with an example", () => {
    const list = getAvailableCommands() as { id: string; example: string }[];
    expect(list).toHaveLength(COMMAND_PATTERNS.length);
    for (const item of list) {
      expect(item.id).toBeTruthy();
      expect(item.example).toBeTruthy();
    }
  });
});
