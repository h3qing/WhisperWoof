/**
 * The hotkey held at release decides where a dictation goes. The same mapping
 * drives the overlay's route chip (shown the moment Fn+letter is detected) and
 * its done label ("Copied" rather than "Pasted"), so it lives in one place.
 */
import { describe, it, expect } from "vitest";
import { routeForHotkey, ROUTED_HOTKEYS } from "./dictation-route";

describe("routeForHotkey", () => {
  it("maps each Fn+letter combo to its destination", () => {
    expect(routeForHotkey("Fn+T")).toBe("copy-to-clipboard");
    expect(routeForHotkey("Fn+N")).toBe("save-as-markdown");
    expect(routeForHotkey("Fn+P")).toBe("project");
  });

  it("pastes at the cursor for plain Fn, no hotkey, or an unknown combo", () => {
    expect(routeForHotkey("Fn")).toBe("paste-at-cursor");
    expect(routeForHotkey(null)).toBe("paste-at-cursor");
    expect(routeForHotkey(undefined)).toBe("paste-at-cursor");
    expect(routeForHotkey("Fn+Q")).toBe("paste-at-cursor");
  });

  it("lists exactly the combos the native listener consumes", () => {
    // Keep in sync with the --routing-keys passed to macos-globe-listener.
    expect([...ROUTED_HOTKEYS].sort()).toEqual(["Fn+N", "Fn+P", "Fn+T"]);
  });
});
