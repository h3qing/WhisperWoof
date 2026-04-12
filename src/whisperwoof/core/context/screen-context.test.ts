/**
 * Tests for Screen Context — voice command detection for selected text.
 *
 * Imports `detectScreenCommand`, `getScreenCommands`, and
 * `SCREEN_COMMANDS` directly from `bridge/screen-context.js`. Source
 * only requires `child_process` + `debugLogger` (both safe at module
 * load) and already exports the full command registry — no `-pure.js`
 * extraction needed.
 *
 * `getSelectedText` runs an osascript subprocess on macOS and
 * `executeScreenCommand` calls Ollama; both are out of scope for pure
 * unit tests.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// @ts-expect-error — CommonJS module, no TS declarations
import {
  detectScreenCommand,
  getScreenCommands,
  SCREEN_COMMANDS,
} from "../../bridge/screen-context";

describe("detectScreenCommand", () => {
  it('detects "summarize" variants', () => {
    expect(detectScreenCommand("summarize this")?.id).toBe("summarize");
    expect(detectScreenCommand("sum up that")?.id).toBe("summarize");
    expect(detectScreenCommand("give me a summary of the selection")?.id).toBe("summarize");
  });

  it('detects "explain" variants', () => {
    expect(detectScreenCommand("explain this")?.id).toBe("explain");
    expect(detectScreenCommand("what does this mean")?.id).toBe("explain");
    expect(detectScreenCommand("break this down")?.id).toBe("explain");
    expect(detectScreenCommand("help me understand")?.id).toBe("explain");
  });

  it('detects "reply" variants', () => {
    expect(detectScreenCommand("reply to this")?.id).toBe("reply");
    expect(detectScreenCommand("respond to that")?.id).toBe("reply");
    expect(detectScreenCommand("answer this")?.id).toBe("reply");
  });

  it('detects "translate" variants', () => {
    expect(detectScreenCommand("translate this")?.id).toBe("translate");
    expect(detectScreenCommand("translate the selection")?.id).toBe("translate");
  });

  it('detects "simplify" variants', () => {
    expect(detectScreenCommand("simplify")?.id).toBe("simplify");
    expect(detectScreenCommand("make this simpler")?.id).toBe("simplify");
    expect(detectScreenCommand("dumb this down")?.id).toBe("simplify");
  });

  it('detects "bullet points" variants', () => {
    expect(detectScreenCommand("turn this into bullet points")?.id).toBe("bullets");
    expect(detectScreenCommand("convert to a list")?.id).toBe("bullets");
    expect(detectScreenCommand("make bullets")?.id).toBe("bullets");
  });

  it("returns null for non-screen-command text", () => {
    expect(detectScreenCommand("I need to buy groceries")).toBeNull();
    expect(detectScreenCommand("create a function")).toBeNull();
  });

  it("returns null for short / empty / null input", () => {
    expect(detectScreenCommand("")).toBeNull();
    expect(detectScreenCommand(null)).toBeNull();
    expect(detectScreenCommand("hi")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectScreenCommand("SUMMARIZE THIS")?.id).toBe("summarize");
    expect(detectScreenCommand("Explain This")?.id).toBe("explain");
  });

  it("returns a prompt + label along with the command id", () => {
    const cmd = detectScreenCommand("summarize this");
    expect(cmd?.prompt).toBeTruthy();
    expect(cmd?.label).toBe("Summarize selection");
  });
});

describe("screen-command vs voice-command disambiguation", () => {
  // Screen commands operate on selected text via the Accessibility API.
  // Voice editing commands (in bridge/voice-commands.js) operate on the
  // clipboard. The trigger regexes must not overlap — if "rewrite this"
  // accidentally matched a screen command, we'd read the selection
  // instead of the clipboard.

  it('"summarize this" is a screen command', () => {
    expect(detectScreenCommand("summarize this")).not.toBeNull();
  });

  it('"rewrite this" is NOT a screen command (it is a voice command)', () => {
    expect(detectScreenCommand("rewrite this")).toBeNull();
  });

  it('"translate this to Spanish" is NOT a screen command (voice command)', () => {
    // Screen-side translate accepts only "translate this / that / the selection".
    // Voice-side translate accepts "translate this to <language>". The screen
    // regex deliberately anchors end-of-string so the longer form doesn't match.
    expect(detectScreenCommand("translate this to Spanish")).toBeNull();
  });
});

describe("SCREEN_COMMANDS registry", () => {
  it("has 6 commands", () => {
    expect(Object.keys(SCREEN_COMMANDS)).toHaveLength(6);
  });

  it("every command has a unique id", () => {
    const ids = Object.values(SCREEN_COMMANDS).map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every command has a label + prompt", () => {
    for (const cmd of Object.values(SCREEN_COMMANDS) as { id: string; label: string; prompt: string; trigger: RegExp }[]) {
      expect(cmd.label).toBeTruthy();
      expect(cmd.prompt).toBeTruthy();
      expect(cmd.trigger).toBeInstanceOf(RegExp);
    }
  });
});

describe("getScreenCommands", () => {
  it("returns { id, label } for every registered command", () => {
    const list = getScreenCommands() as { id: string; label: string }[];
    expect(list).toHaveLength(Object.keys(SCREEN_COMMANDS).length);
    for (const entry of list) {
      expect(entry.id).toBeTruthy();
      expect(entry.label).toBeTruthy();
    }
  });
});
