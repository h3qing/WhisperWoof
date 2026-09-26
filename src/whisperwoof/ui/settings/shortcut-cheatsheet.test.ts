/**
 * The Settings shortcut cheat sheet is a renderer-side copy of the keybinding
 * defaults (bridge/keybindings-pure.js is CommonJS, main process only). This
 * keeps the copy from drifting: every row must match the defaults.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_KEYBINDINGS } from "../../bridge/keybindings-pure";
import { SHORTCUT_CHEATSHEET } from "./shortcut-cheatsheet";

const defaults = Object.values(DEFAULT_KEYBINDINGS) as { key: string; label: string }[];

describe("SHORTCUT_CHEATSHEET", () => {
  it("shows each key with the same label as the keybinding defaults", () => {
    for (const { items } of SHORTCUT_CHEATSHEET) {
      for (const item of items) {
        const labels = defaults.filter((b) => b.key === item.key).map((b) => b.label);
        expect(labels.length, item.key).toBeGreaterThan(0);
        // One key can do two things (Fn: record, then paste): "A / b".
        expect(item.label.toLowerCase(), item.key).toBe(labels.join(" / ").toLowerCase());
      }
    }
  });

  it("says Fn+T copies to the clipboard", () => {
    const routing = SHORTCUT_CHEATSHEET.find((g) => g.group === "Routing");
    expect(routing?.items.find((i) => i.key === "Fn+T")?.label).toBe("Copy to clipboard");
  });
});
