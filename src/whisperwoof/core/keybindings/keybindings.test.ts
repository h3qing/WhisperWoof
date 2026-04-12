/**
 * Tests for Keybinding Customization — validation, merge, conflict
 * detection, bundle validation.
 *
 * Imports `DEFAULT_KEYBINDINGS`, `CATEGORIES`, `isValidKeyCombo`,
 * `mergeWithOverrides`, `detectConflict`, and `validateKeybindingBundle`
 * directly from `bridge/keybindings-pure.js`. These are the same helpers
 * `bridge/keybindings.js` delegates to — any drift between production
 * hotkey behavior and the test suite trips immediately.
 *
 * The persisted-overrides store (load/save JSON) and the Electron
 * globalShortcut registration live in the main bridge module and are
 * out of scope for these unit tests.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — CommonJS module, no TS declarations
import {
  DEFAULT_KEYBINDINGS,
  CATEGORIES,
  KEY_COMBO_PATTERN,
  isValidKeyCombo,
  mergeWithOverrides,
  detectConflict,
  validateKeybindingBundle,
} from "../../bridge/keybindings-pure";

interface MergedBinding {
  actionId: string;
  key: string;
  label: string;
  category: string;
  isCustom: boolean;
  defaultKey: string;
}

describe("isValidKeyCombo", () => {
  it("accepts modifier+key combos", () => {
    expect(isValidKeyCombo("CommandOrControl+K")).toBe(true);
    expect(isValidKeyCombo("Ctrl+Shift+P")).toBe(true);
    expect(isValidKeyCombo("Alt+N")).toBe(true);
    expect(isValidKeyCombo("Shift+Enter")).toBe(true);
    expect(isValidKeyCombo("CommandOrControl+Shift+L")).toBe(true);
  });

  it("accepts Fn combos (our native routing layer)", () => {
    expect(isValidKeyCombo("Fn")).toBe(true);
    expect(isValidKeyCombo("Fn+N")).toBe(true);
    expect(isValidKeyCombo("Fn+T")).toBe(true);
    expect(isValidKeyCombo("Fn+P")).toBe(true);
  });

  it("accepts function keys F1..F12", () => {
    expect(isValidKeyCombo("F1")).toBe(true);
    expect(isValidKeyCombo("F5")).toBe(true);
    expect(isValidKeyCombo("F12")).toBe(true);
  });

  it("accepts single named keys", () => {
    expect(isValidKeyCombo("Space")).toBe(true);
    expect(isValidKeyCombo("Enter")).toBe(true);
    expect(isValidKeyCombo("Escape")).toBe(true);
    expect(isValidKeyCombo("Tab")).toBe(true);
  });

  it("rejects empty / nullish / garbage input", () => {
    expect(isValidKeyCombo("")).toBe(false);
    expect(isValidKeyCombo(null)).toBe(false);
    expect(isValidKeyCombo(undefined)).toBe(false);
    expect(isValidKeyCombo("hello world")).toBe(false);
    expect(isValidKeyCombo("+++")).toBe(false);
  });

  it("exports KEY_COMBO_PATTERN as a RegExp", () => {
    expect(KEY_COMBO_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe("mergeWithOverrides", () => {
  it("returns every default action when no overrides", () => {
    const merged: MergedBinding[] = mergeWithOverrides({});
    expect(merged).toHaveLength(Object.keys(DEFAULT_KEYBINDINGS).length);

    const cmdBar = merged.find((b) => b.actionId === "command-bar");
    expect(cmdBar?.key).toBe("CommandOrControl+K");
    expect(cmdBar?.isCustom).toBe(false);
    expect(cmdBar?.defaultKey).toBe("CommandOrControl+K");
  });

  it("applies a user override and flags isCustom", () => {
    const merged: MergedBinding[] = mergeWithOverrides({
      "command-bar": { key: "CommandOrControl+J" },
    });
    const cmdBar = merged.find((b) => b.actionId === "command-bar");
    expect(cmdBar?.key).toBe("CommandOrControl+J");
    expect(cmdBar?.isCustom).toBe(true);
    expect(cmdBar?.defaultKey).toBe("CommandOrControl+K");
  });

  it("preserves non-overridden defaults", () => {
    const merged: MergedBinding[] = mergeWithOverrides({
      "command-bar": { key: "CommandOrControl+J" },
    });
    const recording = merged.find((b) => b.actionId === "toggle-recording");
    expect(recording?.key).toBe("Fn");
    expect(recording?.isCustom).toBe(false);
  });

  it("handles a missing / undefined overrides argument", () => {
    const merged = mergeWithOverrides();
    expect(merged).toHaveLength(Object.keys(DEFAULT_KEYBINDINGS).length);
  });
});

describe("detectConflict", () => {
  const bindings: MergedBinding[] = mergeWithOverrides({});

  it("returns the conflicting actionId when a key is already bound", () => {
    // CommandOrControl+H is bound to "open-history"
    expect(detectConflict(bindings, "command-bar", "CommandOrControl+H")).toBe("open-history");
  });

  it("returns null when rebinding an action to its own current key", () => {
    expect(detectConflict(bindings, "command-bar", "CommandOrControl+K")).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(detectConflict(bindings, "command-bar", "CommandOrControl+J")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectConflict(bindings, "command-bar", "commandorcontrol+h")).toBe("open-history");
    expect(detectConflict(bindings, "command-bar", "COMMANDORCONTROL+H")).toBe("open-history");
  });

  it("handles empty/null newKey cleanly", () => {
    expect(detectConflict(bindings, "command-bar", "")).toBeNull();
    expect(detectConflict(bindings, "command-bar", null)).toBeNull();
  });
});

describe("validateKeybindingBundle", () => {
  it("accepts a well-formed WhisperWoof keybindings bundle", () => {
    const bundle = {
      version: 1,
      appName: "WhisperWoof",
      type: "keybindings",
      exportedAt: new Date().toISOString(),
      bindings: { "command-bar": { key: "CommandOrControl+J" } },
    };
    expect(validateKeybindingBundle(bundle)).toBeNull();
  });

  it("rejects bundles from a different app", () => {
    expect(validateKeybindingBundle({ appName: "OtherApp", type: "keybindings", bindings: {} }))
      .toContain("Invalid");
  });

  it("rejects bundles with the wrong type", () => {
    expect(validateKeybindingBundle({ appName: "WhisperWoof", type: "settings", bindings: {} }))
      .toContain("Invalid");
  });

  it("rejects bundles without a bindings object", () => {
    expect(validateKeybindingBundle({ appName: "WhisperWoof", type: "keybindings" }))
      .toContain("No bindings");
  });

  it("rejects null / non-object input", () => {
    expect(validateKeybindingBundle(null)).toContain("Invalid");
    expect(validateKeybindingBundle("not a bundle")).toContain("Invalid");
  });
});

describe("DEFAULT_KEYBINDINGS integrity", () => {
  it("every default binding uses a valid key combo", () => {
    for (const binding of Object.values(DEFAULT_KEYBINDINGS) as { key: string }[]) {
      expect(isValidKeyCombo(binding.key)).toBe(true);
    }
  });

  it("every default binding belongs to a real category", () => {
    const categoryIds = new Set((CATEGORIES as { id: string }[]).map((c) => c.id));
    for (const binding of Object.values(DEFAULT_KEYBINDINGS) as { category: string }[]) {
      expect(categoryIds.has(binding.category)).toBe(true);
    }
  });

  it("is frozen so runtime mutation can't corrupt the default list", () => {
    expect(Object.isFrozen(DEFAULT_KEYBINDINGS)).toBe(true);
  });
});
