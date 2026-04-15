/**
 * Tests for Context-Aware Polish — App-to-Preset Mapping.
 *
 * Imports the real `getPresetForApp` + `getAppPresetMap` from the bridge
 * module so these tests catch drift in the production mapping. The OS-level
 * `detectActiveApp` / `detectContextPreset` functions need a macOS osascript
 * subprocess and are covered by manual testing.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { getPresetForApp, getAppPresetMap } from "../../bridge/context-detector";

describe("getPresetForApp", () => {
  it('returns "professional" for email apps', () => {
    expect(getPresetForApp("com.apple.mail")).toBe("professional");
    expect(getPresetForApp("com.microsoft.Outlook")).toBe("professional");
    expect(getPresetForApp("com.superhuman.electron")).toBe("professional");
  });

  it('returns "casual" for chat/messaging apps', () => {
    expect(getPresetForApp("com.tinyspeck.slackmacgap")).toBe("casual");
    expect(getPresetForApp("com.hnc.Discord")).toBe("casual");
    expect(getPresetForApp("com.apple.MobileSMS")).toBe("casual");
    expect(getPresetForApp("ru.keepcoder.Telegram")).toBe("casual");
    expect(getPresetForApp("com.microsoft.teams2")).toBe("casual");
  });

  it('returns "structured" for IDEs and note apps', () => {
    expect(getPresetForApp("com.microsoft.VSCode")).toBe("structured");
    expect(getPresetForApp("com.todesktop.230313mzl4w4u92")).toBe("structured");
    expect(getPresetForApp("com.apple.Notes")).toBe("structured");
    expect(getPresetForApp("md.obsidian")).toBe("structured");
    expect(getPresetForApp("com.notion.id")).toBe("structured");
  });

  it('returns "minimal" for terminal apps', () => {
    expect(getPresetForApp("com.googlecode.iterm2")).toBe("minimal");
    expect(getPresetForApp("com.apple.Terminal")).toBe("minimal");
  });

  it('returns "professional" for document apps', () => {
    expect(getPresetForApp("com.apple.iWork.Pages")).toBe("professional");
    expect(getPresetForApp("com.microsoft.Word")).toBe("professional");
  });

  it('returns "clean" for browsers (default)', () => {
    expect(getPresetForApp("com.apple.Safari")).toBe("clean");
  });

  it("returns null for unknown apps", () => {
    expect(getPresetForApp("com.unknown.app")).toBeNull();
    expect(getPresetForApp("")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(getPresetForApp(null)).toBeNull();
  });

  it("Chrome returns null (needs URL-based detection)", () => {
    expect(getPresetForApp("com.google.Chrome")).toBeNull();
  });
});

describe("app preset map coverage", () => {
  it("every preset in the map is a valid preset ID", () => {
    const validPresets = new Set([
      "clean",
      "professional",
      "casual",
      "minimal",
      "structured",
      null,
    ]);
    const map = getAppPresetMap();
    for (const [, preset] of Object.entries(map)) {
      expect(validPresets.has(preset as string | null)).toBe(true);
    }
  });

  it("getAppPresetMap returns a copy so callers can't mutate the source", () => {
    const first = getAppPresetMap() as Record<string, string | null>;
    first["com.evil.hacker"] = "professional";
    const second = getAppPresetMap() as Record<string, string | null>;
    expect(second["com.evil.hacker"]).toBeUndefined();
  });

  it("is stable across calls", () => {
    expect(getPresetForApp("com.apple.mail")).toBe("professional");
    expect(getPresetForApp("com.apple.mail")).toBe("professional");
  });
});
